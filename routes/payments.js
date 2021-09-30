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
		let { _doc: updatedUser} = await db.User.findOneAndUpdate({ "email": email }, { "paymentMethodId": setupIntent.payment_method }, { new: true})
		console.log(updatedUser)
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