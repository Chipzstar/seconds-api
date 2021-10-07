require("dotenv").config();
const express = require("express");
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const db = require("../models");
const {
	genJobReference,
	getClientDetails,
	getResultantQuotes,
	chooseBestProvider,
	providerCreatesJob,
	genOrderNumber, confirmCharge
} = require("../helpers");
const {AUTHORIZATION_KEY, PROVIDER_ID, STATUS, alphabet} = require("../constants");
const {v4: uuidv4} = require("uuid");
const moment = require("moment");
const {customAlphabet} = require("nanoid");
const mongoose = require("mongoose");
const router = express.Router();

const nanoid = customAlphabet(alphabet, 24)

/**
 * List Jobs - The API endpoint for listing all jobs currently in progress
 * @constructor
 * @param req - request object
 * @param res - response object
 * @param next - moves to the next helper function
 * @returns {Promise<*>}
 */
router.post("/", async (req, res, next) => {
	try {
		const {email} = req.body;
		const user = await db.User.findOne({"email": email}, {})
		const jobs = []
		for (let jobId of user.jobs) {
			const job = await db.Job.findById(jobId, {}, {new: true})
			if (job) {
				console.log(job["_doc"])
				jobs.push({...job["_doc"]})
			}
		}
		return res.status(200).json({
			jobs,
			message: "All jobs returned!"
		})
	} catch (err) {
		console.error(err)
		return next({
			status: 400,
			message: err.message
		})
	}
})

/**
 * Create Job - creates a new delivery job based on delivery requirements
 * @constructor
 * @param req - request object
 * @param res - response object
 * @returns {Promise<*>}
 */
router.post("/create", async (req, res) => {
	try {
		const {
			pickupAddress,
			pickupFormattedAddress,
			pickupPhoneNumber,
			pickupEmailAddress,
			pickupBusinessName,
			pickupFirstName,
			pickupLastName,
			pickupInstructions,
			dropoffAddress,
			dropoffFormattedAddress,
			dropoffPhoneNumber,
			dropoffEmailAddress,
			dropoffBusinessName,
			dropoffFirstName,
			dropoffLastName,
			dropoffInstructions,
			packageDropoffStartTime,
			packageDropoffEndTime,
			packagePickupStartTime,
			packagePickupEndTime,
			packageDescription,
			packageValue,
			packageTax,
			itemsCount,
		} = req.body;
		//fetch api key
		//generate client reference number
		const clientRefNumber = genJobReference();
		const apiKey = req.headers[AUTHORIZATION_KEY];
		const selectedProvider = req.headers[PROVIDER_ID]
		console.log("---------------------------------------------")
		console.log("Provider selected manually: ", Boolean(selectedProvider))
		console.log("SELECTED PROVIDER:", selectedProvider)
		console.log("---------------------------------------------")
		const {_id: clientId, selectionStrategy, stripeCustomerId, subscriptionId } = await getClientDetails(apiKey);
		const QUOTES = await getResultantQuotes(req.body);
		// Use selection strategy to select the winner quote
		const bestQuote = chooseBestProvider(selectionStrategy, QUOTES);
		// checks if the fleet provider for the delivery was manually selected or not
		let providerId, deliveryFee, winnerQuote;
		if (selectedProvider === undefined) {
			providerId = bestQuote.providerId
			deliveryFee = bestQuote.price
			winnerQuote = bestQuote.id
		} else {
			providerId = selectedProvider
			let chosenQuote = QUOTES.find(quote => quote.providerId === selectedProvider.toLowerCase())
			console.log("***************************************************")
			console.log("CHOSEN QUOTE:", chosenQuote)
			console.log("***************************************************")
			deliveryFee = chosenQuote ? chosenQuote.price : null
			winnerQuote = chosenQuote ? chosenQuote.id : null
		}
		if (subscriptionId) {
			/*let idempotencyKey = uuidv4()
			//create the payment intent for the new order
			const paymentIntent = await stripe.paymentIntents.create({
				// * 100 to convert from pounds to pennies
				// * 0.1 to take 10%
				amount: Math.floor((deliveryFee * 100) * 1.1),
				customer: stripeCustomerId,
				currency: 'GBP',
				setup_future_usage: 'off_session',
				payment_method: paymentMethodId,
				payment_method_types: ['card'],
			}, {
				idempotencyKey,
			});
			console.log("-------------------------------------------")
			console.log("Payment Intent Created!", paymentIntent)
			console.log("-------------------------------------------")*/
			const {
				id: spec_id,
				trackingURL,
				pickupAt,
				dropoffAt
			} = await providerCreatesJob(providerId.toLowerCase(), clientRefNumber, req.body)

			const jobs = await db.Job.find({})

			let job = {
				createdAt: moment().toISOString(),
				jobSpecification: {
					id: spec_id,
					orderNumber: genOrderNumber(jobs.length),
					packages: [{
						description: packageDescription,
						dropoffLocation: {
							fullAddress: dropoffAddress,
							street_address: dropoffFormattedAddress.street,
							city: dropoffFormattedAddress.city,
							postcode: dropoffFormattedAddress.postcode,
							country: "UK",
							phoneNumber: dropoffPhoneNumber,
							email: dropoffEmailAddress,
							firstName: dropoffFirstName,
							lastName: dropoffLastName,
							businessName: dropoffBusinessName,
							instructions: dropoffInstructions
						},
						dropoffStartTime: dropoffAt ? moment(dropoffAt).toISOString() : packageDropoffStartTime,
						dropoffEndTime: packageDropoffEndTime,
						itemsCount,
						pickupStartTime: pickupAt ? moment(pickupAt).toISOString() : packagePickupStartTime,
						pickupEndTime: packagePickupEndTime,
						pickupLocation: {
							fullAddress: pickupAddress,
							street_address: pickupFormattedAddress.street,
							city: pickupFormattedAddress.city,
							postcode: pickupFormattedAddress.postcode,
							country: "UK",
							phoneNumber: pickupPhoneNumber,
							email: pickupEmailAddress,
							firstName: pickupFirstName,
							lastName: pickupLastName,
							businessName: pickupBusinessName,
							instructions: pickupInstructions
						},
						tax: packageTax,
						value: packageValue
					}]
				},
				selectedConfiguration: {
					jobReference: clientRefNumber,
					createdAt: moment().toISOString(),
					deliveryFee,
					winnerQuote,
					providerId,
					trackingURL,
					quotes: QUOTES
				},
				status: STATUS.NEW
			}
			// Append the selected provider job to the jobs database
			const createdJob = await db.Job.create({...job, clientId, paymentIntentId: paymentIntent.id})
			// Add the delivery to the users list of jobs
			await db.User.updateOne({apiKey}, {$push: {jobs: createdJob._id}}, {new: true})
			return res.status(200).json({
				jobId: createdJob._id,
				...job,
			})
		} else {
			console.error("No subscription detected!")
			return res.status(402).json({
				error: {
					code: 402,
					message: "Please purchase a subscription plan before making an order. Thank you! 😊"
				}
			})
		}
	} catch (e) {
		console.error("ERROR:", e)
		if (e.message) {
			return res.status(e.code).json({
				error: e
			})
		}
		return res.status(500).json({
			code: 500,
			message: "Unknown error occurred!"
		});
	}
})

/**
 * Get Job - The API endpoint for retrieving created delivery jobs
 * @constructor
 * @param req - request object
 * @param res - response object
 * @returns {Promise<*>}
 */
router.get("/:job_id", async (req, res) => {
	try {
		const {job_id} = req.params;
		let {_doc: {_id, ...foundJob}} = await db.Job.findById(job_id, {})
		if (foundJob) {
			return res.status(200).json({
				jobId: job_id,
				...foundJob
			})
		} else {
			return res.status(404).json({
				code: 404,
				description: `No job found with ID: ${req.params["job_id"]}`,
				message: "Not Found"
			})
		}
	} catch (err) {
		return res.status(500).json({
			...err
		})
	}
})

router.post("/:job_id", async (req, res) => {
	const {stripeCustomerId, status} = req.body;
	const {job_id} = req.params;
	try {
		console.log(req.body)
		if (!Object.keys(req.body).length) {
			return res.status(400).json({
				code: 400,
				description: "Your payload has no properties to update the job",
				message: "Missing Payload!"
			})
		}
		let {_doc: updatedJob} = await db.Job.findByIdAndUpdate(job_id, {"status": status}, {new: true})
		/**
		 * ONLY FOR TESTING - REMOVE WHEN DONE
		 */
		if (status === STATUS.COMPLETED) {
			await confirmCharge(
				Number(updatedJob.jobSpecification.packages[0].value),
				stripeCustomerId,
				updatedJob.paymentIntentId
			)
		}
		let jobs = await db.Job.find({}, {}, {new: true})
		return res.status(200).json({
			updatedJobs: jobs,
			message: "Job status updated!"
		})
	} catch (e) {
		return res.status(404).json({
			code: 404,
			description: `No job found with ID: ${job_id}`,
			message: "Not Found"
		})
	}
})

/**
 * Update Job - The API endpoint for updating details of a delivery job
 * @param req - request object
 * @param res - response object
 * @returns {Promise<*>}
 */
router.patch("/:job_id", async (req, res) => {
	if (!Object.keys(req.body).length) {
		return res.status(400).json({
			code: 400,
			description: "Your payload has no properties to update the job",
			message: "Missing Payload!"
		})
	}
	const {
		packageDescription: description,
		pickupInstructions,
		dropoffInstructions
	} = req.body
	console.log(req.body)
	try {
		let jobId = req.params["job_id"]
		if (mongoose.Types.ObjectId.isValid(jobId)) {
			let {_doc: {_id, ...updatedJob}} = await db.Job.findOneAndUpdate({_id: jobId}, {
				'$set': {
					"jobSpecification.packages.$[].description": description,
					"jobSpecification.packages.$[].pickupLocation.instructions": pickupInstructions,
					"jobSpecification.packages.$[].dropoffLocation.instructions": dropoffInstructions
				},
			}, {
				new: true,
				sanitizeProjection: true,
			})
			return updatedJob ?
				res.status(200).json({
					jobId: _id,
					...updatedJob
				}) : res.status(404).json({
					code: 404,
					description: `No job found with ID: ${jobId}`,
					message: "Not Found"
				})
		} else {
			res.status(404).json({
				code: 404,
				description: `No job found with ID: ${jobId}`,
				message: "Not Found"
			})
		}
	} catch
		(e) {
		console.error(e)
		return res.status(500).json({
			...e
		})
	}
})

/**
 * Delete Job - The API endpoint for cancelling a delivery job
 * @param req - request object
 * @param res - response object
 * @returns {Promise<*>}
 */
router.delete("/:job_id", async (req, res) => {
	try {
		const jobId = req.params["job_id"]
		let foundJob = await db.Job.findByIdAndUpdate(jobId, {"status": STATUS.CANCELLED}, {new: true})
		console.log(foundJob)
		if (foundJob) {
			return res.status(200).json({
				jobId,
				cancelled: true
			})
		} else {
			return res.status(404).json({
				code: 404,
				description: `No job found with ID: ${jobId}`,
				message: "Not Found"
			})
		}
	} catch (err) {
		console.error(err)
		return res.status(500).json({
			...err
		})
	}
})

module.exports = router;

