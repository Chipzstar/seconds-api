require("dotenv").config();
const express = require("express");
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const db = require("../models");
const router = express.Router();

router.post("/setup-intent", async (req, res) => {
	//const key = uuidv4()
	try {
		const setupIntent = await stripe.setupIntents.create({
			payment_method_types: ['card'],
			customer: req.body.stripeCustomerId,
		});
		console.log("==================================================")
		console.log("SETUP INTENT")
		console.log(setupIntent)
		console.log("==================================================")
		res.status(200).json(setupIntent);
	} catch (e) {
		console.error(e)
		res.status(400).json({
			error: {...e}
		})
	}
})

router.post("/add-payment-method", async (req, res) => {
	const {customerId, paymentMethodId, email} = req.body;
	try {
		const customer = await stripe.customers.update(customerId, {
			invoice_settings: {
				default_payment_method: paymentMethodId
			}
		})
		console.log("*************************************")
		console.log("updated customer")
		console.log(customer)
		console.log("*************************************")
		await db.User.findOneAndUpdate({"email": email}, {"paymentMethodId": paymentMethodId}, {new: true})
		res.status(200).json(true)
	} catch (e) {
		console.error(e)
		res.status(400).json({
			error: {...e}
		})
	}
})

router.post("/update-payment-method", async (req, res) => {
	try {
		const { email, paymentMethodId, paymentDetails} = req.body;
		// check if client paymentMethodId matches that stored in the database
		const {paymentMethodId: dbPaymentMethodId} = await db.User.findOne({"email": email}, {});
		if (dbPaymentMethodId === paymentMethodId) {
			// update the card information in stripe
			const paymentMethod = await stripe.paymentMethods.update(
				paymentMethodId,
				{
					billing_details: {
						name: paymentDetails.name
					},
					card: {
						exp_month: paymentDetails.month,
						exp_year: paymentDetails.year
					}
				}
			)
			console.log(paymentMethod)
			return res.status(200).json(paymentMethod)
		} else {
			throw new Error("The payment method you want to change does not exist! Please remove your card and add a new one")
		}
	} catch (e) {
		console.error(e)
		res.status(400).json({
			error: {...e}
		})
	}
})

router.post("/remove-payment-method", async (req, res) => {
	try {
		const {email, paymentMethodId} = req.body;
		// detach payment method from stripe customer
		const paymentMethod = await stripe.paymentMethods.detach(
			paymentMethodId
		)
		console.log("-----------------------------------------")
		console.log(paymentMethod)
		console.log("-----------------------------------------")
		// remove paymentMethodId from user in database
		const user = await db.User.findOneAndUpdate({"email": email}, {"paymentMethodId": ""}, {new: true})
		return res.status(200).json({
			stripeCustomerId: user.stripeCustomerId,
			paymentMethodId: user.paymentMethodId,
			message: "Payment Method Removed!"
		})
	} catch (e) {
		console.error(e)
	}
})

router.post("/fetch-stripe-card", async (req, res) => {
	const {paymentMethodId} = req.body;
	console.log(paymentMethodId)
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

module.exports = router;