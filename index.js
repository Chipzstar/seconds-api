require('newrelic');
require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const moment = require('moment-timezone');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const authRoutes = require('./routes/auth');
const webhookRoutes = require('./routes/webhooks')
const jobRoutes = require('./routes/jobs');
const quoteRoutes = require('./routes/quotes');
const shopifyRoutes = require('./routes/shopify');
const squareRoutes = require('./routes/square');
const woocommerceRoutes = require('./routes/woocommerce');
const squarespaceRoutes = require('./routes/squarespace');
const stuartRoutes = require('./routes/stuart');
const gophrRoutes = require('./routes/gophr');
const streetStreamRoutes = require('./routes/streetStream');
const ecoFleetRoutes = require('./routes/ecofleet');
const port = process.env.PORT || 3001;
moment.tz.setDefault('Europe/London');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const { validateApiKey } = require('./middleware/auth');

// defining the Express index
const app = express();
const db = require('./models/index');
const sendEmail = require('./services/email');

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

//WEBHOOKS
app.use('/api/v1/shopify', shopifyRoutes);
app.use('/api/v1/square', squareRoutes);
app.use('/api/v1/woocommerce', woocommerceRoutes);
app.use('/api/v1/squarespace', squarespaceRoutes);

// EMAIL
app.post('/test/mail', async (req, res) => {
	try {
		const { name, email, subject, text, html, templateId, templateData } = req.body;
		console.table(req.body);
		let options = {
			name,
			email,
			subject,
			...(text && { text: text }),
			...(html && { html: html }),
			...(templateId && { templateId: templateId }),
			...(templateData && { templateData: templateData })
		};
		const response = await sendEmail(options);
		console.log(response);
		res.status(200).json({
			status: 'success',
			message: 'Email sent successfully!'
		});
	} catch (e) {
		console.error(e);
		res.status(400).json({
			status: e.status,
			message: e.message
		});
	}
});

// TEST ENDPOINTS
app.post('/test/webhook', async(req, res, next) => {
	try {
		console.log("------------------------------------------------")
		console.log("SIGNATURE", req.headers['x-seconds-signature'])
		console.log("------------------------------------------------")
	    console.log(req.body)
		res.status(200).json({success: true})
	} catch (err) {
	    console.error(err)
		res.status(400).json({success: false, message: err.message})
	}
})
/*app.get('/test/stripe/report-usage', async (req, res) => {
	try {
		const { deliveryType, quantity } = req.query;
		const apiKey = req.headers[AUTHORIZATION_KEY];
		const { stripeCustomerId, subscriptionItems } = await getClientDetails(apiKey);
		await confirmCharge(stripeCustomerId, subscriptionItems, true, deliveryType, quantity);
		res.status(200).json({ status: 'SUCCESS' });
	} catch (err) {
		console.error(err);
		res.status(400).json({ message: err.message });
	}
});*/

app.post('/test/stripe/confirm-payment', async (req, res) => {
	try {
		const { paymentIntentId, paymentMethodId } = req.body;
		const paymentIntent = await stripe.paymentIntents.confirm(paymentIntentId, {
			payment_method: paymentMethodId
		});
		console.log(paymentIntent);
		res.status(200).json(paymentIntent);
	} catch (err) {
		console.error(err);
		res.status(500).json({ message: err.message });
	}
});
// starting the server
app.listen(port, () => {
	console.log(`listening on port ${port}`);
});
