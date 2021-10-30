require ('newrelic');
require("dotenv").config();
const express = require("express");
const bodyParser = require('body-parser');
const moment = require('moment-timezone');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const authRoutes = require('./routes/auth');
const jobRoutes = require('./routes/jobs');
const quoteRoutes = require('./routes/quotes');
const shopifyRoutes = require('./routes/shopify');
const stuartRoutes = require('./routes/stuart');
const gophrRoutes = require('./routes/gophr');
const streetStreamRoutes = require('./routes/streetStream');
const ecoFleetRoutes = require('./routes/ecofleet')
const port = process.env.PORT || 3001;
moment.tz.setDefault("Europe/London");

const {validateApiKey} = require("./middleware/auth");

// defining the Express index
const app = express();
const db = require('./models/index');

app.set('port', process.env.PORT || port);

// adding Helmet to enhance your API's security
app.use(helmet());

// using bodyParser to parse JSON bodies into JS objects
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({extended: true}));

// enabling CORS for all requests
app.use(cors());

// adding morgan to log HTTP requests
app.use(morgan('combined'));

// defining an endpoint to return a welcome message
app.get('/', (req, res) => {
	res.send("WELCOME TO SECONDS API");
});

// used by New Relic for keeping the api alive
app.use('/ping', (req, res) => {
	const message = `Pinged at ${new Date().toUTCString()}`
	console.log(`${req.ip} - ${message}`)
	res.status(200).json({
		message
	})
})

// CORE ROUTES
app.use('/api/v1/token', authRoutes);
app.use('/api/v1/jobs', validateApiKey, jobRoutes);
app.use('/api/v1/quotes', validateApiKey, quoteRoutes);

// FLEET PROVIDERS ROUTES + WEBHOOKS
app.use('/api/v1/stuart', validateApiKey, stuartRoutes);
app.use('/api/v1/gophr', gophrRoutes);
app.use('/api/v1/ecofleet', ecoFleetRoutes);
app.use('/api/v1/street-stream', streetStreamRoutes);

//WEBHOOKS
app.use('/api/v1/shopify', shopifyRoutes)

// starting the server
app.listen(port, () => {
	console.log(`listening on port ${port}`);
});
