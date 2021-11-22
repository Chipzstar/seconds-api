require('dotenv').config();
const express = require('express');
const db = require('../models');
const {
	genJobReference,
	getClientDetails,
	getResultantQuotes,
	chooseBestProvider,
	providerCreatesJob,
	getVehicleSpecs,
	calculateJobDistance,
	checkAlternativeVehicles,
	checkDeliveryHours,
	setNextDayDeliveryTime,
	genOrderReference,
	providerCreateMultiJob,
	checkMultiDropPrice
} = require('../helpers');
const { AUTHORIZATION_KEY, PROVIDER_ID, STATUS, COMMISSION, DELIVERY_TYPES } = require('../constants');
const moment = require('moment');
const mongoose = require('mongoose');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const orderId = require('order-id')(process.env.UID_SECRET_KEY);

/**
 * List Jobs - The API endpoint for listing all jobs currently belonging to a user
 * @constructor
 * @param req - request object
 * @param res - response object
 * @param next - moves to the next helper function
 * @returns {Promise<*>}
 */
router.get('/', async (req, res) => {
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
					message: 'No user found with that email address'
				});
			}
		} else {
			res.status(400).json({
				code: 400,
				message: "'email' parameter missing. Please append your email address as a query parameter"
			});
		}
	} catch (err) {
		console.error(err);
		res.status(400).json({
			err,
			message: err.message
		});
	}
});

/**
 * Create Job - creates a single point to point job based on delivery requirements
 * @constructor
 * @param req - request object
 * @param res - response object
 * @returns {Promise<*>}
 */
router.post('/create', async (req, res) => {
	try {
		console.table(req.body);
		console.table(req.body.drops[0]);
		let { pickupAddress, packageDeliveryType, packagePickupStartTime, vehicleType } = req.body;
		req.body.drops[0]['reference'] = genOrderReference();
		//generate client reference number
		let paymentIntent = undefined;
		const jobReference = genJobReference();
		// fetch api key
		const apiKey = req.headers[AUTHORIZATION_KEY];
		const selectedProvider = req.headers[PROVIDER_ID];
		console.log('---------------------------------------------');
		console.log('Provider selected manually: ', Boolean(selectedProvider));
		console.log('SELECTED PROVIDER:', selectedProvider);
		console.log('---------------------------------------------');
		// fetch user information from the api key
		const {
			_id: clientId,
			selectionStrategy,
			stripeCustomerId,
			paymentMethodId,
			subscriptionId,
			subscriptionPlan,
			deliveryHours
		} = await getClientDetails(apiKey);
		// check that the vehicleType is valid and return the vehicle's specifications
		let vehicleSpecs = getVehicleSpecs(vehicleType);
		console.log(vehicleSpecs);
		// do job distance calculation
		const jobDistance = await calculateJobDistance(
			pickupAddress,
			req.body.drops[0].dropoffAddress,
			vehicleSpecs.travelMode
		);
		// check if distance is less than or equal to the vehicle's max pickup to dropoff distance
		if (jobDistance > vehicleSpecs.maxDistance) {
			vehicleSpecs = await checkAlternativeVehicles(
				pickupAddress,
				req.body.drops[0].dropoffAddress,
				jobDistance,
				vehicleSpecs.travelMode
			);
		}
		// Check if a pickupStartTime was passed through, if not set it to 45 minutes ahead of current time
		if (!packagePickupStartTime) {
			req.body.packagePickupStartTime = moment().add(45, 'minutes').format();
			req.body.drops[0].packageDropoffStartTime = moment().add(75, 'minutes').format();
		}
		// CHECK DELIVERY HOURS
		let canDeliver = checkDeliveryHours(req.body.packagePickupStartTime, deliveryHours);
		if (!canDeliver) {
			const nextDayDeliveryTime = setNextDayDeliveryTime(deliveryHours);
			req.body.packageDeliveryType = "NEXT_DAY";
			req.body.packagePickupStartTime = nextDayDeliveryTime;
			req.body.drops[0].packageDropoffStartTime = moment(nextDayDeliveryTime).add(30, 'minutes').format();
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
		// check if user has a subscription active
		console.log('SUBSCRIPTION ID:', !!subscriptionId);
		if (subscriptionId && subscriptionPlan) {
			let idempotencyKey = uuidv4();
			// check the payment plan and lookup the associated commission fee
			let { fee, limit } = COMMISSION[subscriptionPlan.toUpperCase()];
			console.log('--------------------------------');
			console.log('COMMISSION FEE:', fee);
			// check whether the client number of orders has exceeded the limit
			const numOrders = await db.Job.where({ clientId: clientId, status: 'COMPLETED' }).countDocuments();
			console.log('NUM COMPLETED ORDERS:', numOrders);
			console.log('--------------------------------');
			// if so create the payment intent for the new order
			if (numOrders >= limit) {
				paymentIntent = await stripe.paymentIntents.create(
					{
						amount: fee * 100,
						customer: stripeCustomerId,
						currency: 'GBP',
						setup_future_usage: 'off_session',
						payment_method: paymentMethodId,
						payment_method_types: ['card']
					},
					{
						idempotencyKey
					}
				);
				console.log('-------------------------------------------');
				console.log('Payment Intent Created!', paymentIntent);
				console.log('-------------------------------------------');
			}
			const paymentIntentId = paymentIntent ? paymentIntent.id : undefined;
			const {
				id: spec_id,
				deliveryFee,
				pickupAt,
				dropoffAt,
				delivery
			} = await providerCreatesJob(
				providerId.toLowerCase(),
				jobReference,
				selectionStrategy,
				req.body,
				vehicleSpecs
			);
			let job = {
				createdAt: moment().format(),
				driverInformation: {
					name: 'Searching',
					phone: 'Searching',
					transport: 'Searching'
				},
				jobSpecification: {
					id: spec_id,
					jobReference,
					shopifyId: null,
					orderNumber: orderId.generate(),
					deliveryType: DELIVERY_TYPES[packageDeliveryType].name,
					pickupStartTime: pickupAt ? moment(pickupAt).format() : req.body.packagePickupStartTime,
					pickupEndTime: req.body.packagePickupEndTime,
					pickupLocation: {
						fullAddress: req.body.pickupAddress,
						streetAddress: String(req.body.pickupAddressLine1).trim(),
						city: String(req.body.pickupCity).trim(),
						postcode: String(req.body.pickupPostcode).trim(),
						country: 'UK',
						phoneNumber: req.body.pickupPhoneNumber,
						email: req.body.pickupEmailAddress,
						firstName: req.body.pickupFirstName,
						lastName: req.body.pickupLastName,
						businessName: req.body.pickupBusinessName,
						instructions: req.body.pickupInstructions
					},
					deliveries: [delivery]
				},
				selectedConfiguration: {
					createdAt: moment().format(),
					deliveryFee,
					winnerQuote,
					providerId,
					quotes: QUOTES
				},
				status: STATUS.NEW
			};
			console.log('======================================================================================');
			console.log('JOB', job);
			console.log('======================================================================================');
			// Append the selected provider job to the jobs database
			const createdJob = await db.Job.create({ ...job, clientId, paymentIntentId });
			return res.status(200).json({
				jobId: createdJob._id,
				...job
			});
		} else {
			console.error('No subscription detected!');
			return res.status(402).json({
				error: {
					code: 402,
					message: 'Please purchase a subscription plan before making an order. Thank you! 😊'
				}
			});
		}
	} catch (err) {
		err.response ? console.error('ERROR:', err.response.data) : console.log('ERROR:', err);
		if (err.message) {
			return res.status(err.code).json({
				error: err
			});
		}
		return res.status(500).json({
			code: 500,
			message: 'Unknown error occurred!'
		});
	}
});

router.post('/multi-drop', async (req, res) => {
	try {
		console.table(req.body);
		let { pickupAddress, packageDeliveryType, packagePickupStartTime, itemsCount, vehicleType, drops } = req.body;
		//generate client reference number
		const jobReference = genJobReference();
		let paymentIntent = undefined;
		// fetch api key
		const apiKey = req.headers[AUTHORIZATION_KEY];
		// fetch user information from the api key
		const {
			_id: clientId,
			selectionStrategy,
			stripeCustomerId,
			paymentMethodId,
			subscriptionId,
			subscriptionPlan,
			deliveryHours
		} = await getClientDetails(apiKey);
		// check that the vehicleType is valid and return the vehicle's specifications
		let vehicleSpecs = getVehicleSpecs(vehicleType);
		console.log(vehicleSpecs);
		// do job distance calculation
		for (let drop of drops) {
			const index = drops.indexOf(drop);
			console.table(drop);
			const jobDistance = await calculateJobDistance(pickupAddress, drop.dropoffAddress, vehicleSpecs.travelMode);
			// check if distance is less than or equal to the vehicle's max pickup to dropoff distance
			if (jobDistance > vehicleSpecs.maxDistance) {
				vehicleSpecs = await checkAlternativeVehicles(
					pickupAddress,
					drop.dropoffAddress,
					jobDistance,
					vehicleSpecs.travelMode
				);
			}
			req.body.drops[index]['reference'] = genOrderReference();
		}
		// Check if a pickupStartTime was passed through, if not set it to 45 minutes ahead of current time
		if (!packagePickupStartTime) packagePickupStartTime = moment().add(45, 'minutes').format();
		// CHECK DELIVERY HOURS
		let canDeliver = checkDeliveryHours(packagePickupStartTime, deliveryHours);
		if (!canDeliver) {
			let interval = 20;
			const nextDayDeliveryTime = setNextDayDeliveryTime(deliveryHours);
			req.body.packageDeliveryType = DELIVERY_TYPES.NEXT_DAY.name;
			req.body.packagePickupStartTime = nextDayDeliveryTime;
			drops.forEach(
				(drop, index) =>
					(req.body.drops[index].packageDropoffStartTime = moment(nextDayDeliveryTime)
						.add(interval * (index + 1), 'minutes')
						.format())
			);
		}
		// check if user has a subscription active
		console.log('SUBSCRIPTION ID:', !!subscriptionId);
		if (subscriptionId && subscriptionPlan) {
			let idempotencyKey = uuidv4();
			// check the payment plan and lookup the associated commission fee
			let { fee: commission, limit } = COMMISSION[subscriptionPlan.toUpperCase()];
			console.log('--------------------------------');
			console.log('COMMISSION FEE:', commission);
			// check whether the client number of orders has exceeded the limit
			const numOrders = await db.Job.where({ clientId: clientId, status: 'COMPLETED' }).countDocuments();
			console.log('NUM COMPLETED ORDERS:', numOrders);
			console.log('--------------------------------');
			// if so create the payment intent for the new order
			let multiDropFee = checkMultiDropPrice(req.body.drops.length);
			if (numOrders >= limit) multiDropFee = multiDropFee + commission;
			paymentIntent = await stripe.paymentIntents.create(
				{
					amount: multiDropFee * 100,
					customer: stripeCustomerId,
					currency: 'GBP',
					setup_future_usage: 'off_session',
					payment_method: paymentMethodId,
					payment_method_types: ['card']
				},
				{
					idempotencyKey
				}
			);
			console.log('-------------------------------------------');
			console.log('Payment Intent Created!', paymentIntent);
			console.log('-------------------------------------------');

			const paymentIntentId = paymentIntent ? paymentIntent.id : undefined;
			const {
				id: spec_id,
				deliveryFee,
				pickupAt,
				deliveries
			} = await providerCreateMultiJob(null, jobReference, selectionStrategy, req.body, vehicleSpecs);
			let job = {
				createdAt: moment().format(),
				driverInformation: {
					name: 'Searching',
					phone: 'Searching',
					transport: 'Searching'
				},
				jobSpecification: {
					id: spec_id,
					shopifyId: null,
					orderNumber: orderId.generate(),
					jobReference,
					deliveryType: packageDeliveryType,
					pickupStartTime: pickupAt ? moment(pickupAt).format() : req.body.packagePickupStartTime,
					pickupEndTime: req.body.packagePickupEndTime,
					pickupLocation: {
						fullAddress: req.body.pickupAddress,
						streetAddress: String(req.body.pickupAddressLine1 + req.body.pickupAddressLine2).trim(),
						city: String(req.body.pickupCity).trim(),
						postcode: String(req.body.pickupPostcode).trim(),
						country: 'UK',
						phoneNumber: req.body.pickupPhoneNumber,
						email: req.body.pickupEmailAddress,
						firstName: req.body.pickupFirstName,
						lastName: req.body.pickupLastName,
						businessName: req.body.pickupBusinessName,
						instructions: req.body.pickupInstructions
					},
					deliveries
				},
				selectedConfiguration: {
					createdAt: moment().format(),
					deliveryFee,
					winnerQuote: '',
					providerId: 'stuart',
					quotes: []
				},
				status: STATUS.NEW
			};
			console.log('======================================================================================');
			console.log('JOB', job);
			console.log('======================================================================================');
			// Append the selected provider job to the jobs database
			const createdJob = await db.Job.create({ ...job, clientId, paymentIntentId });
			return res.status(200).json({
				jobId: createdJob._id,
				...job
			});
		} else {
			console.error('No subscription detected!');
			return res.status(402).json({
				error: {
					code: 402,
					message: 'Please purchase a subscription plan before making an order. Thank you! 😊'
				}
			});
		}
	} catch (err) {
		err.response ? console.error('ERROR:', err.response.data) : console.log('ERROR:', err);
		if (err.message) {
			return res.status(err.code).json({
				error: err
			});
		}
		return res.status(500).json({
			code: 500,
			message: 'Unknown error occurred!'
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
				...job
			});
		} else {
			return res.status(404).json({
				code: 404,
				description: `No job found with ID: ${req.params['job_id']}`,
				message: 'Not Found'
			});
		}
	} catch (err) {
		console.log(err);
		return res.status(500).json({
			...err
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
				message: 'Missing Payload!'
			});
		}
		await db.Job.findByIdAndUpdate(job_id, { status: status }, { new: true });
		let jobs = await db.Job.find({}, {}, { new: true });
		return res.status(200).json({
			updatedJobs: jobs,
			message: 'Job status updated!'
		});
	} catch (e) {
		return res.status(404).json({
			code: 404,
			description: `No job found with ID: ${job_id}`,
			message: 'Not Found'
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
			message: 'Missing Payload!'
		});
	}
	const { packageDescription: description, pickupInstructions, dropoffInstructions } = req.body;
	console.log(req.body);
	try {
		let jobId = req.params['job_id'];
		if (mongoose.Types.ObjectId.isValid(jobId)) {
			let {
				_doc: { _id, ...updatedJob }
			} = await db.Job.findOneAndUpdate(
				{ _id: jobId },
				{
					$set: {
						'jobSpecification.packages.$[].description': description,
						'jobSpecification.packages.$[].pickupLocation.instructions': pickupInstructions,
						'jobSpecification.packages.$[].dropoffLocation.instructions': dropoffInstructions
					}
				},
				{
					new: true,
					sanitizeProjection: true
				}
			);
			return updatedJob
				? res.status(200).json({
						jobId: _id,
						...updatedJob
				  })
				: res.status(404).json({
						code: 404,
						description: `No job found with ID: ${jobId}`,
						message: 'Not Found'
				  });
		} else {
			res.status(404).json({
				code: 404,
				description: `No job found with ID: ${jobId}`,
				message: 'Not Found'
			});
		}
	} catch (e) {
		console.error(e);
		return res.status(500).json({
			...e
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
				cancelled: true
			});
		} else {
			return res.status(404).json({
				code: 404,
				description: `No job found with ID: ${jobId}`,
				message: 'Not Found'
			});
		}
	} catch (err) {
		console.error(err);
		return res.status(500).json({
			...err
		});
	}
});

module.exports = router;
