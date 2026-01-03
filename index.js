const express = require('express')
const cors = require('cors')
require('dotenv').config()
const app = express()
const port = process.env.PORT || 3000

app.use(cors())
app.use(express.json())

const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.eqwoetz.mongodb.net/?appName=Cluster0`;

const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});

async function run() {
    try {

        await client.connect();

        const db = client.db('ship_sync_db')
        const productsCollection = db.collection('products')
        const importsCollection = db.collection('imports')

        app.get('/products/paginated', async (req, res) => {
            try {
                const page = parseInt(req.query.page) || 1
                const limit = parseInt(req.query.limit) || 8
                const search = req.query.search || ""
                const sort = req.query.sort || ""
                
                const skip = (page - 1) * limit
                
                let query = {}
                if (search && search.trim() !== "") {
                    query.product_name = { $regex: search, $options: 'i' }
                }
                
                let sortOptions = {}
                switch(sort) {
                    case 'price-low-high':
                        sortOptions.price = 1
                        break
                    case 'price-high-low':
                        sortOptions.price = -1
                        break
                    case 'rating-high-low':
                        sortOptions.rating = -1
                        break
                    case 'rating-low-high':
                        sortOptions.rating = 1
                        break
                    case 'newest-first':
                        sortOptions.created_at = -1
                        break
                    case 'oldest-first':
                        sortOptions.created_at = 1
                        break
                    case 'popular':
                        sortOptions.rating = -1
                        break
                    default:
                        sortOptions.created_at = -1 
                }
                
                const total = await productsCollection.countDocuments(query)
                
                const products = await productsCollection
                    .find(query)
                    .sort(sortOptions)
                    .skip(skip)
                    .limit(limit)
                    .toArray()
                
                res.send({
                    products,
                    total,
                    page,
                    totalPages: Math.ceil(total / limit),
                    limit
                })
                
            } catch (error) {
                console.error('Error in paginated products:', error)
                res.status(500).send({ error: 'Internal server error' })
            }
        })

        app.get('/products', async (req, res) => {
            const email = req.query.email
            const query = {}
            if (email) {
                query.exporter_email = email
            }

            const cursor = productsCollection.find(query)
            const result = await cursor.toArray()
            res.send(result)
        })

        app.get('/latestProducts', async (req, res) => {
            const cursor = productsCollection.find().sort({ created_at: -1 }).limit(6)
            const result = await cursor.toArray()
            res.send(result)
        })

        app.patch('/products/:id', async (req, res) => {
            const id = req.params.id
            const { decreaseBy } = req.body
            const query = { _id: id }
            const updatedProduct = {
                $inc: { available_quantity: -parseInt(decreaseBy) }
            }
            const result = await productsCollection.updateOne(query, updatedProduct)
            res.send(result)
        })

        // Exported Products APIs
        app.post('/products', async (req, res) => {
            const newProduct = req.body
            newProduct.created_at = new Date()
            const result = await productsCollection.insertOne(newProduct)
            res.send(result)
        })

        app.delete('/products/:id', async (req, res) => {
            const id = req.params.id
            const query = { _id: new ObjectId(id) }
            const result = await productsCollection.deleteOne(query)
            res.send(result)
        })

        app.patch('/exportedProducts/:id', async (req, res) => {
            const id = req.params.id
            const updatedProductDetails = req.body

            const { product_image, product_name, price, origin_country, rating, available_quantity, description } = updatedProductDetails

            const query = { _id: new ObjectId(id) }
            const updatedProduct = {
                $set: {
                    product_image,
                    product_name,
                    price,
                    origin_country,
                    rating,
                    available_quantity,
                    description,
                    updated_at: new Date()
                }
            }
            const result = await productsCollection.updateOne(query, updatedProduct)
            res.send(result)
        })

        // Imported Products APIs
        app.get('/imports', async (req, res) => {
            const email = req.query.email
            const query = {}
            if (email) {
                query.importer_email = email
            }

            const cursor = importsCollection.find(query)
            const result = await cursor.toArray()
            res.send(result)
        })

        app.post('/imports', async (req, res) => {
            const importProduct = req.body
            const { product, importer_email, importing_quantity, importer_name } = importProduct
            const query = { product, importer_email }
            const update = {
                $setOnInsert: { importer_name },
                $inc: { importing_quantity: parseInt(importing_quantity) }
            }
            const options = { upsert: true }
            const result = await importsCollection.updateOne(query, update, options)
            res.send(result)
        })

        app.delete('/imports/:id', async (req, res) => {
            const id = req.params.id
            const query = { _id: new ObjectId(id) }

            const importItem = await importsCollection.findOne(query)
            if (!importItem) {
                return res.status(404).send({ message: "Import not found" })
            }

            const result = await importsCollection.deleteOne(query)

            if (result.deletedCount) {
                await productsCollection.updateOne(
                    { _id: importItem?.product },
                    { $inc: { available_quantity: importItem.importing_quantity } }
                )
            }
            res.send(result)
        })

    } finally {
        // await client.close();
    }
}
run().catch(console.dir);

app.get('/', (req, res) => {
    res.send('ShipSync server is running.')
})

app.listen(port, () => {
    console.log(`ShipSync server is running on port: ${port}`)
})