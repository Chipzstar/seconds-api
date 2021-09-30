const express = require("express");
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const {	v4: uuidv4 } = require('uuid')
const router = express.Router();

router.post("/new-customer", async (req, res) => {
	try {
		const {email, payment_method} = req.body;
		const customer = await stripe.customers.create({
			email,
			payment_method,
			invoice_settings: {
				default_payment_method: payment_method,
			},
		});
		console.log(customer)
		return res.status(201).json({...customer})
	} catch (err) {
		console.error(err)
		return res.status(400).json({
			error: {...err}
		})
	}
	/*const customer = await stripe.customers.create({
		email: 'jenny.rosen@example.com',
		payment_method: 'pm_1FWS6ZClCIKljWvsVCvkdyWg',
		invoice_settings: {
			default_payment_method: 'pm_1FWS6ZClCIKljWvsVCvkdyWg',
		},
	});*/
})

router.post("/setup-intent", async (req, res) => {
	const key = uuidv4()
	console.log('-----+++++')
	console.log(key, req.body)
	try {
		const setupIntent = await stripe.setupIntents.create({
			payment_method_types: ['card'],
			customer: req.body.stripeCustomerId,
			email: req.body.email
		});
		console.log(setupIntent)
		res.status(200).json(setupIntent);
	} catch (e) {
		console.error(e)
		res.status(400).json({
			error: {...e}
		})
	}
})

router.post("/create-intent", async (req, res) => {
	const key = uuidv4()
	console.log(key)
	try {
		const paymentIntent = await stripe.paymentIntents.create({
			amount: 1099,
			currency: 'GBP',
			setup_future_usage: 'off_session',
			payment_method_types: ['card'],
		}, {
			idempotencyKey: key
		});
		console.log(paymentIntent)
		res.status(200).json({client_secret: paymentIntent.client_secret});
	} catch (e) {
		console.error(e)
		res.status(400).json({
			error: {...e}
		})
	}
})

module.exports = router;