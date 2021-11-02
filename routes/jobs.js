require('dotenv').config();
const express = require('express');
const db = require('../models');
const {
	genJobReference,
	getClientDetails,
	getResultantQuotes,
	chooseBestProvider,
	providerCreatesJob,
	genOrderNumber,
	getVehicleSpecs,
	calculateJobDistance,
	checkAlternativeVehicles,
} = require('../helpers');
const { AUTHORIZATION_KEY, PROVIDER_ID, STATUS, alphabet, VEHICLE_CODES_MAP, COMMISSION } = require('../constants');
const moment = require('moment');
const { customAlphabet } = require('nanoid');
const mongoose = require('mongoose');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const router = express.Router();
const nanoid = customAlphabet(alphabet, 24);
const {v4: uuidv4} = require('uuid')

/**
 * List Jobs - The API endpoint for listing all jobs currently belonging to a user
 * @constructor
 * @param req - request object
 * @param res - response object
 * @param next - moves to the next helper function
 * @returns {Promise<*>}
 */
router.get('/', async (req, res, next) => {
	try {
		console.log(req.query);
		const { email } = req.query;
		if (email) {
			const user = await db.User.findOne({ email: email });
			if (user) {
				const clientId = user._id;
				const jobs = await db.Job.find({ clientId: clientId });
				return res.status(200).json(jobs);
			} else {
				res.status(404).json({
					code: 404,
					message: 'No user found with that email address',
				});
			}
		} else {
			res.status(400).json({
				code: 400,
				message: "'email' parameter missing. Please append your email address as a query parameter",
			});
		}
	} catch (err) {
		console.error(err);
		res.status(400).json({
			err,
			message: err.message,
		});
	}
});

/**
 * Create Job - creates a new delivery job based on delivery requirements
 * @constructor
 * @param req - request object
 * @param res - response object
 * @returns {Promise<*>}
 */
router.post('/create', async (req, res) => {
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
			packageDeliveryType,
			packageDropoffStartTime,
			packageDropoffEndTime,
			packagePickupStartTime,
			packagePickupEndTime,
			packageDescription,
			itemsCount,
			vehicleType,
		} = req.body;
		//fetch api key
		//generate client reference number
		let paymentIntent = undefined;
		const clientRefNumber = genJobReference();
		const apiKey = req.headers[AUTHORIZATION_KEY];
		const selectedProvider = req.headers[PROVIDER_ID];
		console.log('---------------------------------------------');
		console.log('Provider selected manually: ', Boolean(selectedProvider));
		console.log('SELECTED PROVIDER:', selectedProvider);
		console.log('---------------------------------------------');
		const { _id: clientId, selectionStrategy, stripeCustomerId, paymentMethodId, subscriptionId, subscriptionPlan } = await getClientDetails(apiKey);
		// check that the vehicleType is valid and return the vehicle's specifications
		let vehicleSpecs = getVehicleSpecs(vehicleType);
		console.log(vehicleSpecs);
		// do job distance calculation
		const jobDistance = await calculateJobDistance(pickupAddress, dropoffAddress, vehicleSpecs.travelMode);
		// check if distance is less than or equal to the vehicle's max pickup to dropoff distance
		if (jobDistance > vehicleSpecs.maxDistance) {
			vehicleSpecs = await checkAlternativeVehicles(
				pickupAddress,
				dropoffAddress,
				jobDistance,
				vehicleSpecs.travelMode
			);
		}

		const QUOTES = await getResultantQuotes(req.body, vehicleSpecs);
		// Use selection strategy to select the winner quote
		const bestQuote = chooseBestProvider(selectionStrategy, QUOTES);
		// checks if the fleet provider for the delivery was manually selected or not
		let providerId, winnerQuote;
		if (selectedProvider === undefined) {
			providerId = bestQuote.providerId;
			winnerQuote = bestQuote.id;
		} else {
			providerId = selectedProvider;
			let chosenQuote = QUOTES.find(quote => quote.providerId === selectedProvider.toLowerCase());
			console.log('***************************************************');
			console.log('CHOSEN QUOTE:', chosenQuote);
			console.log('***************************************************');
			winnerQuote = chosenQuote ? chosenQuote.id : null;
		}
		console.log('SUBSCRIPTION ID', !!subscriptionId);
		// check if user has a subscription active
		if (subscriptionId && subscriptionPlan) {
			let idempotencyKey = uuidv4()
			// check the payment plan and lookup the associated commission fee
			let { fee, limit } = COMMISSION[subscriptionPlan.toUpperCase()]
			console.log("--------------------------------")
			console.log("COMMISSION FEE:", fee)
			// check whether the client number of orders has exceeded the limit
			const numOrders = await db.Job.where({'clientId': clientId,'status': 'COMPLETED'}).countDocuments();
			console.log("NUM ORDERS:", numOrders)
			console.log("--------------------------------")
			// if so create the payment intent for the new order
			if (numOrders > limit){
				paymentIntent = await stripe.paymentIntents.create({
					amount: fee * 100,
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
				console.log("-------------------------------------------")
			}
			const paymentIntentId = paymentIntent ? paymentIntent.id : undefined
			const {
				id: spec_id,
				trackingURL,
				deliveryFee,
				pickupAt,
				dropoffAt,
			} = await providerCreatesJob(
				providerId.toLowerCase(),
				clientRefNumber,
				selectionStrategy,
				req.body,
				vehicleSpecs
			);
			const jobs = await db.Job.find({});
			let job = {
				createdAt: moment().format(),
				driverInformation: {
					name: "Searching",
					phone: "Searching",
					transport: "Searching"
				},
				jobSpecification: {
					id: spec_id,
					shopifyId: null,
					orderNumber: genOrderNumber(jobs.length),
					deliveryType: packageDeliveryType,
					packages: [
						{
							description: packageDescription,
							dropoffLocation: {
								fullAddress: dropoffAddress,
								street_address: dropoffFormattedAddress.street,
								city: dropoffFormattedAddress.city,
								postcode: dropoffFormattedAddress.postcode,
								country: 'UK',
								phoneNumber: dropoffPhoneNumber,
								email: dropoffEmailAddress,
								firstName: dropoffFirstName,
								lastName: dropoffLastName,
								businessName: dropoffBusinessName,
								instructions: dropoffInstructions,
							},
							dropoffStartTime: dropoffAt ? moment(dropoffAt) : packageDropoffStartTime,
							dropoffEndTime: packageDropoffEndTime,
							itemsCount,
							pickupStartTime: pickupAt ? moment(pickupAt) : packagePickupStartTime,
							pickupEndTime: packagePickupEndTime,
							pickupLocation: {
								fullAddress: pickupAddress,
								street_address: pickupFormattedAddress.street,
								city: pickupFormattedAddress.city,
								postcode: pickupFormattedAddress.postcode,
								country: 'UK',
								phoneNumber: pickupPhoneNumber,
								email: pickupEmailAddress,
								firstName: pickupFirstName,
								lastName: pickupLastName,
								businessName: pickupBusinessName,
								instructions: pickupInstructions,
							},
							transport: VEHICLE_CODES_MAP[vehicleType].name,
						},
					],
				},
				selectedConfiguration: {
					jobReference: clientRefNumber,
					createdAt: moment().format(),
					deliveryFee,
					winnerQuote,
					providerId,
					trackingURL,
					quotes: QUOTES,
				},
				status: STATUS.NEW,
			};
			// Append the selected provider job to the jobs database
			const createdJob = await db.Job.create({ ...job, clientId, paymentIntentId});
			// Add the delivery to the users list of jobs
			await db.User.updateOne({ apiKey }, { $push: { jobs: createdJob._id } }, { new: true });
			return res.status(200).json({
				jobId: createdJob._id,
				...job,
			});
		} else {
			console.error('No subscription detected!');
			return res.status(402).json({
				error: {
					code: 402,
					message: 'Please purchase a subscription plan before making an order. Thank you! 😊',
				},
			});
		}
	} catch (e) {
		console.error('ERROR:', e);
		if (e.message) {
			return res.status(e.code).json({
				error: e,
			});
		}
		return res.status(500).json({
			code: 500,
			message: 'Unknown error occurred!',
		});
	}
});

/**
 * Get Job - The API endpoint for retrieving created delivery jobs
 * @constructor
 * @param req - request object
 * @param res - response object
 * @returns {Promise<*>}
 */
router.get('/:job_id', async (req, res) => {
	try {
		const { job_id } = req.params;
		let foundJob = await db.Job.findOne({ _id: job_id });
		if (foundJob) {
			let { _id, ...job } = foundJob['_doc'];
			return res.status(200).json({
				jobId: job_id,
				...job,
			});
		} else {
			return res.status(404).json({
				code: 404,
				description: `No job found with ID: ${req.params['job_id']}`,
				message: 'Not Found',
			});
		}
	} catch (err) {
		console.log(err);
		return res.status(500).json({
			...err,
		});
	}
});

router.post('/:job_id', async (req, res) => {
	const { status } = req.body;
	const { job_id } = req.params;
	try {
		console.log(req.body);
		if (!Object.keys(req.body).length) {
			return res.status(400).json({
				code: 400,
				description: 'Your payload has no properties to update the job',
				message: 'Missing Payload!',
			});
		}
		await db.Job.findByIdAndUpdate(job_id, { status: status }, { new: true });
		let jobs = await db.Job.find({}, {}, { new: true });
		return res.status(200).json({
			updatedJobs: jobs,
			message: 'Job status updated!',
		});
	} catch (e) {
		return res.status(404).json({
			code: 404,
			description: `No job found with ID: ${job_id}`,
			message: 'Not Found',
		});
	}
});

/**
 * Update Job - The API endpoint for updating details of a delivery job
 * @param req - request object
 * @param res - response object
 * @returns {Promise<*>}
 */
router.patch('/:job_id', async (req, res) => {
	if (!Object.keys(req.body).length) {
		return res.status(400).json({
			code: 400,
			description: 'Your payload has no properties to update the job',
			message: 'Missing Payload!',
		});
	}
	const { packageDescription: description, pickupInstructions, dropoffInstructions } = req.body;
	console.log(req.body);
	try {
		let jobId = req.params['job_id'];
		if (mongoose.Types.ObjectId.isValid(jobId)) {
			let {
				_doc: { _id, ...updatedJob },
			} = await db.Job.findOneAndUpdate(
				{ _id: jobId },
				{
					$set: {
						'jobSpecification.packages.$[].description': description,
						'jobSpecification.packages.$[].pickupLocation.instructions': pickupInstructions,
						'jobSpecification.packages.$[].dropoffLocation.instructions': dropoffInstructions,
					},
				},
				{
					new: true,
					sanitizeProjection: true,
				}
			);
			return updatedJob
				? res.status(200).json({
						jobId: _id,
						...updatedJob,
				  })
				: res.status(404).json({
						code: 404,
						description: `No job found with ID: ${jobId}`,
						message: 'Not Found',
				  });
		} else {
			res.status(404).json({
				code: 404,
				description: `No job found with ID: ${jobId}`,
				message: 'Not Found',
			});
		}
	} catch (e) {
		console.error(e);
		return res.status(500).json({
			...e,
		});
	}
});

/**
 * Delete Job - The API endpoint for cancelling a delivery job
 * @param req - request object
 * @param res - response object
 * @returns {Promise<*>}
 */
router.delete('/:job_id', async (req, res) => {
	try {
		const jobId = req.params['job_id'];
		let foundJob = await db.Job.findByIdAndUpdate(jobId, { status: STATUS.CANCELLED }, { new: true });
		console.log(foundJob);
		if (foundJob) {
			return res.status(200).json({
				jobId,
				cancelled: true,
			});
		} else {
			return res.status(404).json({
				code: 404,
				description: `No job found with ID: ${jobId}`,
				message: 'Not Found',
			});
		}
	} catch (err) {
		console.error(err);
		return res.status(500).json({
			...err,
		});
	}
});

module.exports = router;

