const express = require("express");
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const {	v4: uuidv4 } = require('uuid')
const db = require("../models");
const router = express.Router();

router.post("/setup-intent", async (req, res) => {
	const { email } = req.body;
	//const key = uuidv4()
	console.log('-----+++++')
	try {
		const setupIntent = await stripe.setupIntents.create({
			payment_method_types: ['card'],
			customer: req.body.stripeCustomerId
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

router.post("/add-payment-method", async (req, res) => {
	const { paymentMethodId, email } = req.body;
	console.log('!!!!!!!!!!!!!!!!!!!!')

	console.log(paymentMethodId)
	console.log(email)
	//const key = uuidv4()
	try {
		let updatedUser = await db.User.findOneAndUpdate({ "email": email }, { "paymentMethodId": paymentMethodId }, { new: true})
		console.log(updatedUser)
		res.status(200).json(true)
	} catch (e) {
		console.error(e)
		res.status(400).json({
			error: {...e}
		})
	}
})

router.post("/fetch-stripe-card", async (req, res) => {
	const { paymentMethodId } = req.body;
	console.log(paymentMethodId)
	console.log('[][][][]]')
	//const key = uuidv4()
	try {
		const paymentMethod = await stripe.paymentMethods.retrieve(
			paymentMethodId
		);
		console.log(paymentMethod)
		res.status(200).json(paymentMethod)
	} catch (e) {
		console.error(e)
		res.status(400).json({
			error: {...e}
		})
	}
})

/*router.post("/create-intent", async (req, res) => {
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
})*/

module.exports = router;