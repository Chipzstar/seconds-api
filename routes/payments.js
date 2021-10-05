require("dotenv").config();
const express = require("express");
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const db = require("../models");
const moment = require("moment")
const DOMAIN = require("domain");
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
	const {paymentMethodId, email} = req.body;
	console.log(paymentMethodId)
	console.log(email)
	//const key = uuidv4()
	try {
		let updatedUser = await db.User.findOneAndUpdate({"email": email}, {"paymentMethodId": paymentMethodId}, {new: true})
		console.log(updatedUser)
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

router.post("/setup-subscription", async (req, res) => {
	const {email, stripeCustomerId} = req.body;
	//const key = uuidv4()
	try {
		const subscription = await stripe.subscriptions.create({
			customer: stripeCustomerId,
			items: [
				{price: process.env.STRIPE_SUBSCRIPTION_ID},
			],
		});
		console.log("SUBSCRIPTION:", subscription)
		//attach the subscription id to the user
		const updatedUser = db.User.findOneAndUpdate({"email": email}, {"stripeSubscriptionId": subscription.id}, {new: true})
		console.log(updatedUser)
		res.status(200).json(subscription)
	} catch (e) {
		console.error(e)
		res.status(400).json({
			error: {...e}
		})
	}
})

router.post("/fetch-stripe-subscription", async (req, res) => {
	const {stripeSubscriptionId} = req.body;
	console.log(stripeSubscriptionId)
	try {
		const subscription = await stripe.subscriptions.retrieve(
			stripeSubscriptionId
		);
		console.log(subscription)
		res.status(200).json(subscription)
	} catch (e) {
		console.error(e)
		res.status(400).json({
			error: {...e}
		})
	}
})

router.post("/cancel-subscription", async (req, res) => {
	const {email} = req.body;
	// get the subscription id from the customer
	const {stripeSubscriptionId} = db.User.findOne({"email": email}, {})
	const deleted = await stripe.subscriptions.del(
		stripeSubscriptionId
	);
	res.status(200).json({
		stripeSubscriptionId: deleted.id,
		cancelledAt: moment(deleted.canceled_at).toISOString(),
		status: deleted.status
	})
})

router.post('/create-checkout-session', async (req, res) => {
	const {lookup_key} = req.body;
	const prices = await stripe.prices.list({
		lookup_keys: [lookup_key],
		expand: ['data.product'],
	});
	const session = await stripe.checkout.sessions.create({
		billing_address_collection: 'auto',
		payment_method_types: ['card'],
		line_items: [
			{
				price: prices.data[0].id,
				// For metered billing, do not pass quantity
				quantity: 1,
			},
		],
		mode: 'subscription',
		success_url: `${DOMAIN}/payment?success=true&session_id={CHECKOUT_SESSION_ID}`,
		cancel_url: `${DOMAIN}/payment?canceled=true`,
	});
	res.redirect(303, session.url)
});

router.post('/create-portal-session', async (req, res) => {
	const {stripeCustomerId} = req.body;
	// managing their billing with the portal.
	const portalSession = await stripe.billingPortal.sessions.create({
		customer: stripeCustomerId,
		// This is the url to which the customer will be redirected when they are done
		return_url: DOMAIN,
	});
	res.redirect(303, portalSession.url);
});


module.exports = router;