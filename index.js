process.env.NODE_ENV === 'production' && require('newrelic');
require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const moment = require('moment-timezone');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
//CORE ROUTES
const authRoutes = require('./routes/auth');
const webhookRoutes = require('./routes/webhooks')
const jobRoutes = require('./routes/jobs');
const quoteRoutes = require('./routes/quotes');
// E-COMMERCE ROUTES
const shopifyRoutes = require('./routes/shopify');
const woocommerceRoutes = require('./routes/woocommerce');
const squarespaceRoutes = require('./routes/squarespace');
const hubriseRoutes = require('./routes/hubrise');
// COURIER ROUTES
const stuartRoutes = require('./routes/stuart');
const gophrRoutes = require('./routes/gophr');
const streetStreamRoutes = require('./routes/streetStream');
const ecoFleetRoutes = require('./routes/ecofleet');
// TEST ROUTES
const testRoutes = require('./routes/test');
const port = process.env.PORT || 3001;
moment.tz.setDefault('Europe/London');

const { validateApiKey } = require('./middleware/auth');

// defining the Express index
const app = express();
const db = require('./models/index');
const sendEmail = require('./services/email');
const sendSMS = require('./services/sms');

app.set('port', process.env.PORT || port);

// adding Helmet to enhance your API's security
app.use(helmet());

// using bodyParser to parse JSON bodies into JS objects
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// enabling CORS for all requests
app.use(cors());

// adding morgan to log HTTP requests
app.use(morgan('combined'));

// defining an endpoint to return a welcome message
app.get('/', (req, res) => {
	res.send('WELCOME TO SECONDS API');
});

// used by New Relic for keeping the api alive
app.use('/ping', (req, res) => {
	const message = `Pinged at ${new Date().toUTCString()}`;
	console.log(`${req.ip} - ${message}`);
	res.status(200).json({
		message
	});
});

// CORE ROUTES
app.use('/api/v1/token', authRoutes);
app.use('/api/v1/webhooks', validateApiKey, webhookRoutes);
app.use('/api/v1/jobs', validateApiKey, jobRoutes);
app.use('/api/v1/quotes', validateApiKey, quoteRoutes);

// FLEET PROVIDERS ROUTES + WEBHOOKS
app.use('/api/v1/stuart', validateApiKey, stuartRoutes);
app.use('/api/v1/gophr', gophrRoutes);
app.use('/api/v1/ecofleet', ecoFleetRoutes);
app.use('/api/v1/street-stream', streetStreamRoutes);

// E-COMMERCE WEBHOOKS
app.use('/api/v1/shopify', shopifyRoutes);
app.use('/api/v1/woocommerce', woocommerceRoutes);
app.use('/api/v1/squarespace', squarespaceRoutes);
app.use('/api/v1/hubrise', hubriseRoutes);

// SERVICE WEBHOOKS
app.post('/api/v1/twilio', async (req, res ) => {
	try {
	    console.log(req.body)
		res.status(200).json(req.body)
	} catch (err) {
	    console.error(err)
		throw err
	}
})
// TEST ENDPOINTS
app.use('/test', testRoutes)

// starting the server
app.listen(port, () => {
	console.log(`listening on port ${port}`);
});
