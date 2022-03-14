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
	checkPickupHours,
	setNextDayDeliveryTime,
	genOrderReference,
	providerCreateMultiJob,
	sendNewJobEmails,
	cancelOrder,
	geocodeAddress,
	genDeliveryId,
	checkJobExpired
} = require('../helpers');
const {
	AUTHORIZATION_KEY,
	PROVIDER_ID,
	STATUS,
	COMMISSION,
	DELIVERY_TYPES,
	PROVIDERS,
	VEHICLE_CODES_MAP
} = require('../constants');
const moment = require('moment');
const mongoose = require('mongoose');
const router = express.Router();
const orderId = require('order-id')(process.env.UID_SECRET_KEY);
const sendEmail = require('../services/email');
const sendSMS = require('../services/sms');
const sendNotification = require('../services/notification');

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
		const { email, driverId } = req.query;
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
		} else if (driverId) {
			const driver = await db.Driver.findById(driverId);
			if (driver) {
				const jobs = await db.Job.find({
					'selectedConfiguration.providerId': PROVIDERS.PRIVATE,
					'driverInformation.id': driverId
				});
				jobs.sort((a, b) => b.createdAt - a.createdAt);
				return res.status(200).json(jobs);
			} else {
				res.status(404).json({
					code: 404,
					message: 'No driver found with that driver Id'
				});
			}
		} else {
			res.status(400).json({
				code: 400,
				message: 'client email / driver id query parameter is missing from request'
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
 * Create Courier Job - creates a single point to point job based on delivery requirements and assigns to a fleet provider
 * @constructor
 * @param req - request object
 * @param res - response object
 * @returns {Promise<*>}
 */
router.post('/create', async (req, res) => {
	try {
		console.table(req.body);
		console.table(req.body.drops[0]);
		let { pickupAddress, packageDeliveryType, vehicleType } = req.body;
		req.body.drops[0]['reference'] = genOrderReference();
		//generate client reference number
		let commissionCharge = false;
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
			company,
			selectionStrategy,
			subscriptionItems,
			subscriptionId,
			subscriptionPlan,
			deliveryHours,
			team
		} = await getClientDetails(apiKey);
		let settings = await db.Settings.findOne({ clientId });
		let smsEnabled = settings ? settings.sms : false;
		let newJobAlerts = settings ? settings['jobAlerts'].new : false
		// check that the vehicleType is valid and return the vehicle's specifications
		let vehicleSpecs = getVehicleSpecs(vehicleType);
		console.table(vehicleSpecs);
		// do job distance calculation
		const jobDistance = await calculateJobDistance(
			pickupAddress,
			req.body.drops[0].dropoffAddress,
			vehicleSpecs.travelMode
		);
		// get geo-coordinates of pickup + dropoff locations (if not passed in the request)
		if (!(req.body.pickupLatitude && req.body.pickupLongitude)) {
			let {
				formattedAddress: { longitude, latitude }
			} = await geocodeAddress(req.body.pickupAddress);
			req.body.pickupLatitude = latitude;
			req.body.pickupLongitude = longitude;
		}
		if (!(req.body.drops[0].dropoffLatitude && !req.body.drops[0].dropoffLongitude)) {
			const {
				formattedAddress: { longitude, latitude }
			} = await geocodeAddress(req.body.drops[0].dropoffAddress);
			req.body.drops[0].dropoffLatitude = latitude;
			req.body.drops[0].dropoffLongitude = longitude;
		}
		// Check if a pickupStartTime was passed through, if not set it to 15 minutes ahead of current time
		if (packageDeliveryType === DELIVERY_TYPES.ON_DEMAND.name) {
			req.body.packagePickupStartTime = moment().add(15, 'minutes').format();
			req.body.drops[0].packageDropoffEndTime = moment().add(2, 'hours').format();
		}
		// CHECK DELIVERY HOURS
		let canDeliver = checkPickupHours(req.body.packagePickupStartTime, deliveryHours);
		if (!canDeliver) {
			const { nextDayPickup, nextDayDropoff } = setNextDayDeliveryTime(
				req.body.packagePickupStartTime,
				deliveryHours
			);
			console.table({ nextDayPickup, nextDayDropoff });
			req.body.packageDeliveryType = 'NEXT_DAY';
			req.body.packagePickupStartTime = nextDayPickup;
			req.body.drops[0].packageDropoffEndTime = nextDayDropoff;
		}
		const QUOTES = await getResultantQuotes(req.body, vehicleSpecs, jobDistance, settings);
		// Use selection strategy to select the winner quote
		const bestQuote = chooseBestProvider(selectionStrategy, QUOTES);
		// checks if the fleet provider for the delivery was manually selected or not
		let providerId, winnerQuote;
		if (!bestQuote) {
			const error = new Error('No couriers available at this time. Please try again later!');
			error.status = 500;
			throw error;
		} else if (selectedProvider === undefined) {
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
			// check the payment plan and lookup the associated commission fee
			let { fee, limit } = COMMISSION[subscriptionPlan.toUpperCase()];
			console.log('--------------------------------');
			console.log('COMMISSION FEE:', fee);
			// check whether the client number of orders has exceeded the limit
			const numOrders = await db.Job.where({ clientId: clientId, status: STATUS.COMPLETED }).countDocuments();
			console.log('NUM COMPLETED ORDERS:', numOrders);
			console.log('--------------------------------');
			// if the order limit is exceeded, mark the job with a commission fee charge
			if (numOrders >= limit) {
				commissionCharge = true;
			}
			const {
				id: spec_id,
				deliveryFee,
				pickupAt,
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
					transport: vehicleSpecs.name
				},
				jobSpecification: {
					id: spec_id,
					jobReference,
					orderNumber: orderId.generate(),
					deliveryType: DELIVERY_TYPES[packageDeliveryType].name,
					pickupStartTime: pickupAt ? moment(pickupAt).format() : req.body.packagePickupStartTime,
					pickupEndTime: req.body.packagePickupEndTime,
					pickupLocation: {
						fullAddress: req.body.pickupAddress,
						streetAddress: String(req.body.pickupAddressLine1).trim(),
						city: String(req.body.pickupCity).trim(),
						postcode: String(req.body.pickupPostcode).trim(),
						latitude: req.body.pickupLatitude,
						longitude: req.body.pickupLongitude,
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
			const createdJob = await db.Job.create({ ...job, clientId, commissionCharge });
			newJobAlerts && sendNewJobEmails(team, job).then(res => console.log(res));
			const trackingMessage = delivery.trackingURL ? `\n\nTrack your delivery here: ${delivery.trackingURL}` : '';
			const template = `Your ${company} order has been created and accepted. The driver will pick it up shortly and delivery will be attempted today. ${trackingMessage}`;
			sendSMS(delivery.dropoffLocation.phoneNumber, template, subscriptionItems, smsEnabled).then(message =>
				console.log(message)
			);
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
		await sendEmail({
			email: 'chipzstar.dev@gmail.com',
			name: 'Chisom Oguibe',
			subject: `Failed Order: ${req.headers[AUTHORIZATION_KEY]}`,
			text: `Job could not be created. Reason: ${err.message}`,
			html: `<p>Job could not be created. Reason: ${err.message}</p>`
		});
		err.response ? console.error('ERROR:', err.response.data) : console.log('ERROR:', err);
		if (err.message) {
			return res.status(err.status).json({
				error: err
			});
		}
		return res.status(500).json({
			error: {
				code: 500,
				message: 'Unknown error occurred!'
			}
		});
	}
});

/**
 * Assign Delivery Job - Assigns a single point to point job based on delivery requirements to a custom driver
 * @constructor
 * @param req - request object
 * @param res - response object
 * @returns {Promise<*>}
 */
router.post('/assign', async (req, res) => {
	try {
		const { driverId } = req.query;
		const driver = await db.Driver.findById(driverId);
		console.table(req.body);
		console.table(req.body.drops[0]);
		let { pickupAddress, packageDeliveryType, vehicleType } = req.body;
		req.body.drops[0]['reference'] = genOrderReference();
		//generate client reference number
		let commissionCharge = false;
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
			email,
			firstname,
			lastname,
			company,
			subscriptionItems,
			subscriptionId,
			subscriptionPlan,
			deliveryHours,
			team
		} = await getClientDetails(apiKey);
		let settings = await db.Settings.findOne({ clientId });
		let smsEnabled = settings ? settings.sms : false;
		let newJobAlerts = settings ? settings['jobAlerts'].new : false
		console.table({ smsEnabled, newJobAlerts });
		// check that the vehicleType is valid and return the vehicle's specifications
		let vehicleSpecs = getVehicleSpecs(vehicleType);
		console.table(vehicleSpecs);
		// do job distance calculation
		const jobDistance = await calculateJobDistance(
			pickupAddress,
			req.body.drops[0].dropoffAddress,
			vehicleSpecs.travelMode
		);
		// get geo-coordinates of pickup + dropoff locations (if not passed in the request)
		if (!(req.body.pickupLatitude && req.body.pickupLongitude)) {
			let {
				formattedAddress: { longitude, latitude }
			} = await geocodeAddress(req.body.pickupAddress);
			req.body.pickupLatitude = latitude;
			req.body.pickupLongitude = longitude;
		}
		if (!(req.body.drops[0].dropoffLatitude && !req.body.drops[0].dropoffLongitude)) {
			const {
				formattedAddress: { longitude, latitude }
			} = await geocodeAddress(req.body.drops[0].dropoffAddress);
			req.body.drops[0].dropoffLatitude = latitude;
			req.body.drops[0].dropoffLongitude = longitude;
		}
		// Check if a pickupStartTime was passed through, if not set it to 15 minutes ahead of current time
		if (packageDeliveryType === DELIVERY_TYPES.ON_DEMAND.name) {
			req.body.packagePickupStartTime = moment().add(15, 'minutes').format();
			req.body.drops[0].packageDropoffEndTime = moment().add(2, 'hours').format();
		}
		// CHECK DELIVERY HOURS
		let canDeliver = checkPickupHours(req.body.packagePickupStartTime, deliveryHours);
		if (!canDeliver) {
			const { nextDayPickup, nextDayDropoff } = setNextDayDeliveryTime(
				req.body.packagePickupStartTime,
				deliveryHours
			);
			console.table({ nextDayPickup, nextDayDropoff });
			req.body.packageDeliveryType = 'NEXT_DAY';
			req.body.packagePickupStartTime = nextDayPickup;
			req.body.drops[0].packageDropoffEndTime = nextDayDropoff;
		}
		// check if user has a subscription active
		console.log('SUBSCRIPTION ID:', !!subscriptionId);
		if (subscriptionId && subscriptionPlan) {
			// check the payment plan and lookup the associated commission fee
			let { fee, limit } = COMMISSION[subscriptionPlan.toUpperCase()];
			console.log('--------------------------------');
			console.log('COMMISSION FEE:', fee);
			// check whether the client number of orders has exceeded the limit
			const numOrders = await db.Job.where({ clientId: clientId, status: STATUS.COMPLETED }).countDocuments();
			console.log('NUM COMPLETED ORDERS:', numOrders);
			console.log('--------------------------------');
			// if the order limit is exceeded, mark the job with a commission fee charge
			if (numOrders >= limit) {
				commissionCharge = true;
			}
			const orderNumber = orderId.generate();
			let job = {
				createdAt: moment().format(),
				driverInformation: {
					id: `${driver['_id']}`,
					name: `${driver.firstname} ${driver.lastname}`,
					phone: driver.phone,
					transport: VEHICLE_CODES_MAP[driver.vehicle].name
				},
				jobSpecification: {
					id: genDeliveryId(),
					jobReference,
					orderNumber,
					deliveryType: DELIVERY_TYPES[packageDeliveryType].name,
					pickupStartTime: req.body.packagePickupStartTime,
					pickupEndTime: req.body.packagePickupEndTime,
					pickupLocation: {
						fullAddress: req.body.pickupAddress,
						streetAddress: String(req.body.pickupAddressLine1).trim(),
						city: String(req.body.pickupCity).trim(),
						postcode: String(req.body.pickupPostcode).trim(),
						latitude: req.body.pickupLatitude,
						longitude: req.body.pickupLongitude,
						country: 'UK',
						phoneNumber: req.body.pickupPhoneNumber,
						email: req.body.pickupEmailAddress,
						firstName: req.body.pickupFirstName,
						lastName: req.body.pickupLastName,
						businessName: req.body.pickupBusinessName,
						instructions: req.body.pickupInstructions
					},
					deliveries: [
						{
							id: genDeliveryId(),
							orderReference: req.body.drops[0]['reference'],
							description: req.body.drops[0]['packageDescription'],
							dropoffStartTime: req.body.drops[0].packageDropoffStartTime,
							dropoffEndTime: req.body.drops[0].packageDropoffEndTime,
							transport: vehicleSpecs.name,
							dropoffLocation: {
								fullAddress: req.body.drops[0].dropoffAddress,
								streetAddress:
									req.body.drops[0].dropoffAddressLine1 + req.body.drops[0].dropoffAddressLine2,
								city: req.body.drops[0].dropoffCity,
								postcode: req.body.drops[0].dropoffPostcode,
								country: 'UK',
								latitude: req.body.drops[0].dropoffLatitude,
								longitude: req.body.drops[0].dropoffLongitude,
								phoneNumber: req.body.drops[0].dropoffPhoneNumber,
								email: req.body.drops[0].dropoffEmailAddress,
								firstName: req.body.drops[0].dropoffFirstName,
								lastName: req.body.drops[0].dropoffLastName,
								businessName: req.body.drops[0].dropoffBusinessName
									? req.body.drops[0].dropoffBusinessName
									: '',
								instructions: req.body.drops[0].dropoffInstructions
									? req.body.drops[0].dropoffInstructions
									: ''
							},
							trackingURL: '',
							status: STATUS.PENDING
						}
					]
				},
				selectedConfiguration: {
					createdAt: moment().format(),
					deliveryFee: settings ? settings['driverDeliveryFee'] : 5.0,
					winnerQuote: 'N/A',
					providerId: 'private',
					quotes: []
				},
				status: STATUS.PENDING
			};
			console.log('======================================================================================');
			console.log('JOB', job);
			console.log('======================================================================================');
			// Append the selected provider job to the jobs database
			const createdJob = await db.Job.create({ ...job, clientId, commissionCharge });
			newJobAlerts && sendNewJobEmails(team, job).then(res => console.log(res));
			const template = `Your ${company} order has been created and accepted. The driver will pick it up shortly and delivery will be attempted today.`;
			sendSMS(req.body.drops[0].dropoffPhoneNumber, template, subscriptionItems, smsEnabled).then(() =>
				console.log('SMS sent successfully!')
			);
			// send driver notification
			// sendNotification([""]).then(() => console.log("sent"))
			// set driver response timeout which changes the status of the job to CANCELLED when job is not accepted before that time
			settings &&
				setTimeout(
					() =>
						checkJobExpired(
							orderNumber,
							driver,
							{
								email,
								firstname,
								lastname
							},
							settings
						),
					settings['driverResponseTime'] * 60000
				);
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
		await sendEmail({
			email: 'chipzstar.dev@gmail.com',
			name: 'Chisom Oguibe',
			subject: `Failed Order: ${req.headers[AUTHORIZATION_KEY]}`,
			text: `Job could not be assigned to driver. Reason: ${err.message}`,
			html: `<p>Job could not be assigned to driver. Reason: ${err.message}</p>`
		});
		err.response ? console.error('ERROR:', err.response.data) : console.log('ERROR:', err);
		if (err.message) {
			return res.status(err.status).json({
				error: err
			});
		}
		return res.status(500).json({
			error: {
				code: 500,
				message: 'Unknown error occurred!'
			}
		});
	}
});

router.patch('/dispatch', async (req, res) => {
	try {
		const apiKey = req.headers[AUTHORIZATION_KEY];
		const { _id: clientId, email, firstname, lastname } = await getClientDetails(apiKey);
		const { driverId, orderNumber } = req.body;
		const driver = await db.Driver.findById(driverId);
		const job = await db.Job.findOne({ 'jobSpecification.orderNumber': orderNumber });
		if (job && driver) {
			job.driverInformation.id = driver._id;
			job.driverInformation.name = `${driver.firstname} ${driver.lastname}`;
			job.driverInformation.phone = driver.phone;
			job.driverInformation.transport = driver.vehicle;
			await job.save();
			console.log(job);
			// use clientId of the job to find the client's settings
			const settings = await db.Settings.findOne({ clientId });
			settings &&
				setTimeout(
					() =>
						checkJobExpired(
							orderNumber,
							driver,
							{
								email,
								firstname,
								lastname
							},
							settings
						),
					settings['driverResponseTime'] * 60000
				);
			res.status(200).json(job);
		} else {
			let err = new Error('ID for the job/driver is invalid');
			err.status = 404;
			throw err;
		}
	} catch (err) {
		console.error(err);
		if (err.message) {
			return res.status(err.status).json({
				error: err
			});
		}
		return res.status(500).json({
			error: {
				code: 500,
				message: 'Unknown error occurred!'
			}
		});
	}
});

/**
 * Create Multi-drop Job - creates a job with multiple dropoffs based on delivery requirements
 * @constructor
 * @param req - request object
 * @param res - response object
 * @returns {Promise<*>}
 */
router.post('/multi-drop', async (req, res) => {
	try {
		let { pickupAddress, packageDeliveryType, packagePickupStartTime, vehicleType, drops } = req.body;
		//generate client reference number
		const jobReference = genJobReference();
		let commissionCharge = false;
		// fetch api key
		const apiKey = req.headers[AUTHORIZATION_KEY];
		// fetch user information from the api key
		const {
			_id: clientId,
			selectionStrategy,
			subscriptionId,
			subscriptionPlan,
			deliveryHours,
			team
		} = await getClientDetails(apiKey);
		let settings = await db.Settings.findOne({ clientId });
		let newJobAlerts = settings ? settings['jobAlerts'].new : false
		// check that the vehicleType is valid and return the vehicle's specifications
		let vehicleSpecs = getVehicleSpecs(vehicleType);
		console.table(vehicleSpecs);
		// do job distance calculation
		for (let drop of drops) {
			const index = drops.indexOf(drop);
			const jobDistance = await calculateJobDistance(pickupAddress, drop.dropoffAddress, vehicleSpecs.travelMode);
			// check if distance is less than or equal to the vehicle's max pickup to dropoff distance
			if (jobDistance > vehicleSpecs.maxDistance) {
				vehicleSpecs = await checkAlternativeVehicles(
					pickupAddress,
					drop.dropoffAddress,
					jobDistance,
					vehicleSpecs
				);
			}
			req.body.drops[index]['reference'] = genOrderReference();
		}
		// Check if a pickupStartTime was passed through, if not set it to 45 minutes ahead of current time
		if (!packagePickupStartTime) {
			req.body.packagePickupStartTime = moment().add(30, 'minutes').format();
		}
		//TODO - Test multi drop with dashboard -> use packageDropoffEndTime instead of packageDropoffStartTime to base dropoff windows (see line 336)
		// CHECK DELIVERY HOURS
		let canDeliver = checkPickupHours(req.body.packagePickupStartTime, deliveryHours);
		if (!canDeliver) {
			const { nextDayPickup, nextDayDropoff } = setNextDayDeliveryTime(
				req.body.packagePickupStartTime,
				deliveryHours
			);
			console.table({ nextDayPickup, nextDayDropoff });
			req.body.packageDeliveryType = DELIVERY_TYPES.NEXT_DAY.name;
			req.body.packagePickupStartTime = nextDayPickup;
			drops.forEach(
				(drop, index) => (req.body.drops[index].packageDropoffEndTime = moment(nextDayDropoff).format())
			);
		}
		// check if user has a subscription active
		console.log('SUBSCRIPTION ID:', !!subscriptionId);
		if (subscriptionId && subscriptionPlan) {
			// check the payment plan and lookup the associated commission fee
			let { fee: commission, limit } = COMMISSION[subscriptionPlan.toUpperCase()];
			console.log('--------------------------------');
			// check whether the client number of orders has exceeded the limit
			const numOrders = await db.Job.where({ clientId: clientId, status: 'COMPLETED' }).countDocuments();
			console.table({ numOrders, commission, limit });
			console.log('--------------------------------');
			// if so create the payment intent for the new order
			if (numOrders >= limit) commissionCharge = true;
			const {
				id: spec_id,
				deliveryFee,
				pickupAt,
				deliveries,
				providerId
			} = await providerCreateMultiJob(
				PROVIDERS.STREET_STREAM,
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
					transport: vehicleSpecs.name
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
					deliveryFee: deliveryFee.toFixed(2),
					winnerQuote: '',
					providerId,
					quotes: []
				},
				status: STATUS.NEW
			};
			console.log('======================================================================================');
			console.log('JOB', job);
			console.log('======================================================================================');
			// Append the selected provider job to the jobs database
			const createdJob = await db.Job.create({ ...job, clientId, commissionCharge });
			newJobAlerts &&	sendNewJobEmails(team, job).then(res => console.log(res));
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
			return res.status(err.status).json({
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
		const { comment } = req.query;
		const id = req.params['job_id'];
		console.table(id, comment);
		let foundJob = await db.Job.findByIdAndUpdate(id, { status: STATUS.CANCELLED }, { new: true });
		console.log(foundJob);
		if (foundJob) {
			let jobId = foundJob.jobSpecification.id;
			let provider = foundJob.selectedConfiguration.providerId;
			let message = await cancelOrder(jobId, provider, foundJob, comment);
			console.log(message);
			return res.status(200).json({
				message,
				jobId,
				cancelled: true
			});
		} else {
			return res.status(404).json({
				code: 404,
				description: `No job found with ID: ${id}`,
				message: 'Not Found'
			});
		}
	} catch (err) {
		err.response ? console.error('RESPONSE ERROR:', err.response.data) : console.log('GENERAL ERROR:', err);
		if (err.response.data) {
			return res.status(err.response.status).json({
				error: err.response.data
			});
		}
		return res.status(500).json({
			code: 500,
			message: 'Unknown error occurred!'
		});
	}
});

module.exports = router;
