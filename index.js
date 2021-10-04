require("dotenv").config();
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const express = require("express");
const bodyParser = require('body-parser');
const moment = require('moment-timezone');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const jobRoutes = require('./routes/jobs');
const quoteRoutes = require('./routes/quotes');
const paymentRoutes = require('./routes/payments')
const stuartRoutes = require('./routes/stuart')
const gophrRoutes = require('./routes/gophr')
const port = process.env.PORT || 3001;
moment.tz.setDefault("Europe/London");

const {validateApiKey} = require("./middleware/auth");

// defining the Express index
const index = express();
const db = require('./models/index');
const {genJobReference} = require("./helpers");

index.set('port', process.env.PORT || port);

// adding Helmet to enhance your API's security
index.use(helmet());

// using bodyParser to parse JSON bodies into JS objects
index.use(bodyParser.json());

// enabling CORS for all requests
index.use(cors());

// adding morgan to log HTTP requests
index.use(morgan('combined'));

// add middleware
// index.use(validateApiKey)

// defining an endpoint to return a welcome message
index.get('/', (req, res) => {
	res.send("WELCOME TO SECONDS API");
});

// CORE ROUTES
index.use('/api/v1/jobs', validateApiKey, jobRoutes);
index.use('/api/v1/quotes', validateApiKey, quoteRoutes);

// FLEET PROVIDERS ROUTES + WEBHOOKS
index.use('/api/v1/stuart', validateApiKey, stuartRoutes);
index.use('/api/v1/gophr', gophrRoutes);

// PAYMENTS ROUTES
index.use('/api/v1/payments', paymentRoutes)

// starting the server
index.listen(port, () => {
	console.log(`listening on port ${port}`);
	genJobReference()
});
