const express = require('express');
const axios = require('axios');
const axiosRetry = require('axios-retry');
const { Client } = require('@googlemaps/google-maps-services-js');
const { pickupSchema, dropoffSchema } = require('../schemas/stuart/CreateJob');
const qs = require('qs');
const db = require('../models');
const crypto = require('crypto');
const Base64 = require('crypto-js/enc-base64');
const HmacSHA256 = require('crypto-js/hmac-sha256');
const moment = require('moment-timezone');
const { nanoid } = require('nanoid');
const orderId = require('order-id')(process.env.UID_SECRET_KEY);
const { quoteSchema, jobRequestSchema } = require('../schemas');
// CONSTANTS
const { STRATEGIES } = require('../constants/streetStream');
const { ERROR_CODES: STUART_ERROR_CODES, ERROR_MESSAGES } = require('../constants/stuart');
const { ERROR_CODES: GOPHR_ERROR_CODES } = require('../constants/gophr');
// HELPERS
const { updateHerokuConfigVars } = require('./heroku');
const { getStuartAuthToken } = require('./couriers/stuart');
const { authStreetStream } = require('./couriers/streetStream');
// SERVICES
const sendEmail = require('../services/email');
const sendSMS = require('../services/sms');
const {
	SELECTION_STRATEGIES,
	PROVIDERS,
	DELIVERY_TYPES,
	VEHICLE_CODES,
	STATUS,
	VEHICLE_CODES_MAP,
	DISPATCH_MODES
} = require('@seconds-technologies/database_schemas/constants');
const sendNotification = require('../services/notification');
const { MAGIC_BELL_CHANNELS } = require('../constants');
// google maps api client
const GMapsClient = new Client();
// setup axios instances
const stuartAxios = axios.create();
const streetStreamAxios = axios.create();
const webhookAxios = axios.create();
stuartAxios.defaults.headers.common['Authorization'] = `Bearer ${process.env.STUART_API_KEY}`;
streetStreamAxios.defaults.headers.common['Authorization'] = `Bearer ${process.env.STREET_STREAM_API_KEY}`;
// if fails, retry request with exponential backoff
axiosRetry(webhookAxios, { retries: 3, retryDelay: axiosRetry.exponentialDelay, retryCondition: _error => true });
// set GLOBAL config-vars object for updating multiple heroku env variables
let CONFIG_VARS = {};
let stuartTimeout;
let streetStreamTimeout;

stuartAxios.interceptors.response.use(
	response => {
		return response;
	},
	error => {
		if (
			error.response &&
			error.response.status === 401 &&
			error.response.data.message === ERROR_MESSAGES.ACCESS_TOKEN_REVOKED
		) {
			return getStuartAuthToken()
				.then(token => {
					// clear any ongoing timeouts
					stuartTimeout && clearTimeout(stuartTimeout);
					streetStreamTimeout && clearTimeout(streetStreamTimeout);
					// update config vars
					CONFIG_VARS = { ...CONFIG_VARS, STUART_API_KEY: token };
					// set the timeout to update config vars after 20s
					stuartTimeout =
						process.env.NODE_ENV === 'production'
							? setTimeout(() => {
									updateHerokuConfigVars(CONFIG_VARS).then(() => {
										// set the timeout variable to be null
										stuartTimeout = null;
										// remove old config vars from the global cache object
										CONFIG_VARS = {};
									});
							  }, 20000)
							: null;
					error.config.headers['Authorization'] = `Bearer ${token}`;
					return stuartAxios.request(error.config);
				})
				.catch(err => Promise.reject(err));
		}
		return Promise.reject(error);
	}
);

streetStreamAxios.interceptors.response.use(
	response => response,
	error => {
		console.error(error.response);
		if (error.response && error.response.status === 403) {
			return authStreetStream()
				.then(token => {
					// clear any ongoing timeouts
					stuartTimeout && clearTimeout(stuartTimeout);
					streetStreamTimeout && clearTimeout(streetStreamTimeout);
					// update config-vars
					CONFIG_VARS = { ...CONFIG_VARS, STREET_STREAM_API_KEY: token };
					// set the timeout to update config vars after 20s
					streetStreamTimeout =
						process.env.NODE_ENV === 'production'
							? setTimeout(() => {
									updateHerokuConfigVars(CONFIG_VARS).then(() => {
										// set the timeout variable to be null
										stuartTimeout = null;
										// remove old config vars from the global cache object
										CONFIG_VARS = {};
									});
							  }, 20000)
							: null;
					error.config.headers['Authorization'] = `Bearer ${token}`;
					return streetStreamAxios.request(error.config);
				})
				.catch(err => Promise.reject(err));
		}
		return Promise.reject(error);
	}
);

function genOrderReference() {
	const rand = crypto.randomBytes(16);
	let chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'.repeat(2);

	let str = 'SECONDS-Order#';

	for (let i = 0; i < rand.length; i++) {
		let index = rand[i] % chars.length;
		str += chars[index];
	}
	console.log('Generated ORDER Reference:', str);
	return str;
}

function genJobReference() {
	const rand = crypto.randomBytes(12);
	let chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'.repeat(2);

	let str = 'SECONDS-JOB#';

	for (let i = 0; i < rand.length; i++) {
		let index = rand[i] % chars.length;
		str += chars[index];
	}
	console.log('Generated JOB Reference:', str);
	return str;
}

function genDeliveryId() {
	const rand = crypto.randomBytes(16);
	let chars = 'abcdefghijklmnopqrstuvwxyz0123456789'.repeat(2);

	let str = '';

	for (let i = 0; i < rand.length; i++) {
		let index = rand[i] % chars.length;
		str += chars[index];
	}
	console.log('Generated Job Specification Id:', str);
	return str;
}

function createJobRequestPayload({ jobSpecification, vehicleType }) {
	let payload = {
		...jobRequestSchema,
		pickupFirstName: jobSpecification.pickupLocation.firstName,
		pickupLastName: jobSpecification.pickupLocation.lastName,
		pickupBusinessName: jobSpecification.pickupLocation.businessName,
		pickupAddress: jobSpecification.pickupLocation.fullAddress,
		pickupAddressLine1: jobSpecification.pickupLocation.streetAddress,
		pickupAddressLine2: '',
		pickupCity: jobSpecification.pickupLocation.city,
		pickupPostcode: jobSpecification.pickupLocation.postcode,
		pickupLongitude: jobSpecification.pickupLocation.longitude,
		pickupLatitude: jobSpecification.pickupLocation.latitude,
		pickupEmailAddress: jobSpecification.pickupLocation.email,
		pickupPhoneNumber: jobSpecification.pickupLocation.phoneNumber,
		pickupInstructions: jobSpecification.pickupLocation.instructions,
		packagePickupStartTime: jobSpecification.pickupStartTime,
		...(jobSpecification.pickupEndTime && { packagePickupEndTime: jobSpecification.pickupStartTime }),
		drops: jobSpecification.deliveries.map(({ description, dropoffLocation, dropoffEndTime }) => ({
			dropoffFirstName: dropoffLocation.firstName,
			dropoffLastName: dropoffLocation.lastName,
			dropoffBusinessName: dropoffLocation.businessName,
			dropoffAddress: dropoffLocation.fullAddress,
			dropoffAddressLine1: dropoffLocation.streetAddress,
			dropoffAddressLine2: '',
			dropoffLatitude: dropoffLocation.latitude,
			dropoffLongitude: dropoffLocation.longitude,
			dropoffCity: dropoffLocation.city,
			dropoffPostcode: dropoffLocation.postcode,
			dropoffEmailAddress: dropoffLocation.email,
			dropoffPhoneNumber: dropoffLocation.phoneNumber,
			dropoffInstructions: dropoffLocation.instructions,
			packageDropoffEndTime: dropoffEndTime,
			packageDescription: description,
			reference: genOrderReference()
		})),
		packageDeliveryType: jobSpecification.deliveryType,
		vehicleType
	};
	console.log('***********************************************');
	console.log(payload);
	console.log('***********************************************');
	return payload;
}

function chooseBestProvider(strategy, quotes) {
	let bestPriceIndex;
	let bestEtaIndex;
	let bestPrice = Infinity;
	let bestEta = Infinity;
	// check that at least 1 quote was generated,
	// if no quotes then skip the courier optimization and return undefined
	if (!quotes.length) {
		console.log('No quotes available');
		return undefined;
	}
	quotes.forEach(({ priceExVAT, dropoffEta, providerId }, index) => {
		// console.log('------------------------');
		// console.log(providerId);
		// console.log('------------------------');
		if (priceExVAT < bestPrice) {
			bestPrice = priceExVAT;
			bestPriceIndex = index;
		}
		// console.log(dropoffEta);
		// console.log(moment(dropoffEta));
		let duration = moment.duration(moment(dropoffEta).diff(moment())).asSeconds();
		// console.log('DURATION:', duration);
		if (duration < bestEta) {
			bestEta = duration;
			bestEtaIndex = index;
		}
	});
	console.log('BEST');
	if (strategy === SELECTION_STRATEGIES.PRICE) {
		console.table(quotes[bestPriceIndex]);
		return quotes[bestPriceIndex];
	} else {
		console.table(quotes[bestEtaIndex]);
		return quotes[bestEtaIndex];
	}
}

async function calculateJobDistance(origin, destination, mode) {
	console.log('PICKUP:', origin);
	console.log('DROPOFF:', destination);
	try {
		const distanceMatrix = (
			await GMapsClient.distancematrix({
				params: {
					origins: [origin],
					destinations: [destination],
					key: process.env.GOOGLE_MAPS_API_KEY,
					units: 'imperial',
					mode
				},
				responseType: 'json'
			})
		).data;
		console.log(distanceMatrix.rows[0].elements[0]);
		let distance = Number(distanceMatrix.rows[0].elements[0].distance.text.split(' ')[0]);
		let unit = distanceMatrix.rows[0].elements[0].distance.text.split(' ')[1];
		if (unit === 'ft') distance = 4;
		console.log('================================================');
		console.log('JOB DISTANCE');
		console.log(distance + ' miles');
		console.log('================================================');
		return distance;
	} catch (err) {
		throw err;
	}
}

function checkMultiDropPrice(numDrops) {
	switch (numDrops) {
		case numDrops >= 5 && numDrops <= 9:
			return 7;
		case numDrops >= 10 && numDrops <= 19:
			return 6;
		case numDrops >= 20 && numDrops <= 30:
			return 5;
		default:
			return 7;
	}
}

function getVehicleSpecs(vehicleCode) {
	// TODO - convert to promise based function
	if (VEHICLE_CODES.includes(vehicleCode)) {
		return VEHICLE_CODES_MAP[vehicleCode];
	} else {
		const error = new Error(
			`Vehicle code ${vehicleCode} is not recognized. Please check our list of allowed vehicle codes`
		);
		error.code = 400;
		throw error;
	}
}

async function checkAlternativeVehicles(pickup, dropoff, jobDistance, vehicleSpecs) {
	try {
		for (let [code, specs] of Object.entries(VEHICLE_CODES_MAP)) {
			// if travelMode of the transport type changes, calculate the job distance again using the new mode
			if (vehicleSpecs.travelMode !== specs.travelMode)
				jobDistance = await calculateJobDistance(pickup, dropoff, specs.travelMode);
			// if jobDistance is within the vehicle's allowed max limit
			if (jobDistance <= specs.maxDistance) {
				console.log('Changing Vehicle Type:', specs.name);
				vehicleSpecs.stuart = specs.stuart;
				return vehicleSpecs;
			}
		}
		vehicleSpecs.stuart.packageType = null;
		return vehicleSpecs;
	} catch (err) {
		console.log(err);
		throw err;
	}
}

// TODO - used in seconds-server, remove duplication by placing into database schemas
function checkPickupHours(pickupTime, deliveryHours) {
	console.log('===================================================================');
	const deliveryDay = String(moment(pickupTime).day());
	console.log('Current Day:', deliveryDay);
	// get open / close times for the current day of the week
	const open = moment({
		y: moment(pickupTime).get('year'),
		M: moment(pickupTime).get('month'),
		d: moment(pickupTime).get('date'),
		h: deliveryHours[deliveryDay].open['h'],
		m: deliveryHours[deliveryDay].open['m']
	});
	const close = moment({
		y: moment(pickupTime).get('year'),
		M: moment(pickupTime).get('month'),
		d: moment(pickupTime).get('date'),
		h: deliveryHours[deliveryDay].close['h'],
		m: deliveryHours[deliveryDay].close['m']
	});
	const canDeliver = deliveryHours[deliveryDay].canDeliver;
	// check time of creation is within the delivery hours
	let timeFromOpen = moment.duration(moment(pickupTime).diff(open)).asHours();
	let timeFromClose = moment.duration(moment(pickupTime).diff(close)).asHours();
	console.log('DURATION:', { open: open.format('HH:mm'), timeFromOpen });
	console.log('DURATION:', { close: close.format('HH:mm'), timeFromClose });
	console.log('===================================================================');
	const isValid = canDeliver && timeFromOpen >= 0 && timeFromClose <= -0.5;
	console.log('Is pickup time valid:', isValid);
	return isValid;
}

function setNextDayDeliveryTime(pickupTime, deliveryHours) {
	console.log('===================================================================');
	const max = 6;
	let interval = 0;
	let nextDay = moment(pickupTime).day();
	console.log('Current Day:', nextDay);
	// check that the store has at least one day in the week that allows delivery
	const isValid = Object.entries(JSON.parse(JSON.stringify(deliveryHours))).some(
		([_, value]) => value.canDeliver === true
	);
	// check if the datetime is not in the past & if store allows delivery on that day, if not check another day
	if (isValid) {
		// if a day does not allow deliveries OR the day does allow delivery BUT the order's PICKUP time is PAST of the current day's OPENING time (only when nextDay = "deliveryDay")
		// iterate over to the next day
		// OTHERWISE set the pickup time = store open hour for current day, dropoff time = store closing hour for current day
		console.log('CAN DELIVER:', deliveryHours[nextDay].canDeliver);
		while (
			!deliveryHours[nextDay].canDeliver ||
			moment(pickupTime).diff(
				moment({
					y: moment(pickupTime).get('year'),
					M: moment(pickupTime).get('month'),
					d: moment(pickupTime).get('date'),
					h: deliveryHours[nextDay].open['h'],
					m: deliveryHours[nextDay].open['m']
				}).add(interval, 'days'),
				'minutes'
			) > 0
		) {
			nextDay === max ? (nextDay = 0) : (nextDay = nextDay + 1);
			console.log('Next Day:', nextDay);
			console.log('CAN DELIVER:', deliveryHours[nextDay].canDeliver);
			interval = interval + 1;
		}
		// return the pickup time for the next day delivery
		const open = {
			y: moment(pickupTime).get('year'),
			M: moment(pickupTime).get('month'),
			d: moment(pickupTime).get('date'),
			h: deliveryHours[nextDay].open['h'],
			m: deliveryHours[nextDay].open['m']
		};
		const close = {
			y: moment(pickupTime).get('year'),
			M: moment(pickupTime).get('month'),
			d: moment(pickupTime).get('date'),
			h: deliveryHours[nextDay].close['h'],
			m: deliveryHours[nextDay].close['m']
		};
		console.log('===================================================================');
		return {
			nextDayPickup: moment(open).add(interval, 'days').format(),
			nextDayDropoff: moment(close).add(interval, 'days').format()
		};
	} else {
		throw new Error('Store has no delivery hours available!');
	}
}

async function findAvailableDriver(user, { autoDispatch }) {
	try {
		console.log('-----------------------------------------------');
		console.log('FINDING AVAILABLE DRIVER...');
		// fetch all verified drivers under the client
		let drivers = await db.Driver.find({ clientIds: user['_id'], verified: true });
		console.log('================================================');
		console.log(drivers);
		console.log('-----------------------------------------------');
		// check if settings require drivers to be online, if so filter to include only online drivers
		if (autoDispatch.onlineOnly) drivers = Array.from(drivers).filter(driver => driver.isOnline);
		// if the client has drivers, check to see if a driver's order capacity does not exceed the threshold under the clients maxOrder settings
		if (drivers.length) {
			for (let driver of drivers) {
				// get the job count for each driver
				const jobCount = await db.Job.count({
					clientId: user['_id'],
					'selectedConfiguration.providerId': 'private',
					'driverInformation.id': driver._id,
					status: { $in: [STATUS.DISPATCHING, STATUS.EN_ROUTE] }
				});
				console.table({
					driverId: driver._id,
					jobCount,
					maxOrders: autoDispatch.maxOrders,
					onlineOnly: autoDispatch.onlineOnly
				});
				// compare jobCount with the max threshold
				if (jobCount < autoDispatch.maxOrders) {
					return driver;
				}
			}
		}
		return null;
	} catch (err) {
		console.error(err);
		throw err;
	}
}

async function checkJobExpired(orderNumber, driver, user, settings) {
	let futureJob = await db.Job.findOne({ 'jobSpecification.orderNumber': orderNumber });
	if (futureJob && [STATUS.NEW, STATUS.PENDING].includes(futureJob.status)) {
		futureJob.status = STATUS.CANCELLED;
		await futureJob.save();
		console.log(
			`Order: ${orderNumber} has been cancelled\nReason: No driver accepted the order within your response time window`
		);
		if (settings['jobAlerts'].expired) {
			await sendEmail({
				email: user.email,
				name: `${user.firstname} ${user.lastname}`,
				subject: `Job Expired #${orderNumber}`,
				text: `Hey, ${driver.firstname} ${driver.lastname} has not accepted the delivery you assigned to them.\n The order has now been cancelled and you can re-assign the delivery to another driver!`,
				html: `<p>Hey, ${driver.firstname} ${driver.lastname} has not accepted the delivery you assigned to them.<br/>The order has now been cancelled, and you can re-assign the delivery to another driver!</p>`
			});
			const title = `Job Expired!`;
			const content = `Order ${orderNumber} was not accepted by your driver on time and is now cancelled`;
			sendNotification(clientId, title, content, MAGIC_BELL_CHANNELS.BUSINESS_WORKFLOWS).then(() =>
				console.log('notification sent!')
			);
		}
	} else {
		console.log(`No job found with order number: ${orderNumber}`);
	}
}

// QUOTE AGGREGATION
// send delivery request to integrated providers
async function getResultantQuotes(requestBody, vehicleSpecs, jobDistance, settings) {
	try {
		const QUOTES = [];
		// check if distance is less than or equal to the vehicle's max pickup to dropoff distance
		if (jobDistance > vehicleSpecs.maxDistance) {
			vehicleSpecs = await checkAlternativeVehicles(
				requestBody.pickupAddress,
				requestBody.drops[0].dropoffAddress,
				jobDistance,
				vehicleSpecs
			);
			console.log('NEW Vehicle Specs');
			console.table(vehicleSpecs);
		}
		// check if the current vehicle is supported by Stuart and if the job distance is within the maximum limit
		if (
			vehicleSpecs.stuart.packageType &&
			process.env.STUART_STATUS === 'active' &&
			settings.activeFleetProviders.stuart
		) {
			let stuartQuote = await getStuartQuote(genJobReference(), requestBody, vehicleSpecs);
			stuartQuote && QUOTES.push(stuartQuote);
		}
		if (process.env.GOPHR_STATUS === 'active' && settings.activeFleetProviders.gophr) {
			let gophrQuote = await getGophrQuote(requestBody, vehicleSpecs);
			gophrQuote && QUOTES.push(gophrQuote);
		}
		if (process.env.STREET_STREAM_STATUS === 'active' && settings.activeFleetProviders.street_stream) {
			let streetStreamQuote = await getStreetStreamQuote(requestBody, vehicleSpecs);
			streetStreamQuote && QUOTES.push(streetStreamQuote);
		}
		if (
			vehicleSpecs.ecofleetVehicle &&
			process.env.ECOFLEET_STATUS === 'active' &&
			settings.activeFleetProviders.ecofleet
		) {
			let ecoFleetQuote = {
				...quoteSchema,
				id: `quote_${nanoid(15)}`,
				createdAt: moment().format(),
				expireTime: moment().add(5, 'minutes').format(),
				dropoffEta: null,
				transport: vehicleSpecs.name,
				priceExVAT: Infinity,
				currency: 'GBP',
				providerId: PROVIDERS.ECOFLEET
			};
			QUOTES.push(ecoFleetQuote);
		}
		return QUOTES;
	} catch (err) {
		console.error('getResultantQuotes function:', err);
		throw err;
	}
}

async function providerCreatesJob(provider, ref, strategy, request, vehicleSpecs) {
	switch (provider) {
		case PROVIDERS.STUART:
			console.log('Creating STUART Job');
			return await stuartJobRequest(ref, request, vehicleSpecs);
		case PROVIDERS.GOPHR:
			console.log('Creating GOPHR Job');
			return await gophrJobRequest(ref, request, vehicleSpecs);
		case PROVIDERS.STREET_STREAM:
			console.log('Creating STREET-STREAM Job');
			return await streetStreamJobRequest(ref, strategy, request, vehicleSpecs);
		case PROVIDERS.ECOFLEET:
			console.log('Creating ECOFLEET Job');
			return await ecofleetJobRequest(ref, request, vehicleSpecs);
		// default case if no valid providerId was chosen
		default:
			console.log('Creating a STUART Job');
			return await stuartJobRequest(ref, request);
	}
}

async function providerCreateMultiJob(provider, ref, strategy, request, vehicleSpecs) {
	switch (provider) {
		case PROVIDERS.STUART:
			console.log('Creating STUART Job');
			return await stuartMultiJobRequest(ref, request, vehicleSpecs);
		case PROVIDERS.STREET_STREAM:
			console.log('Creating STREET-STREAM Job');
			return await streetStreamMultiJobRequest(ref, strategy, request, vehicleSpecs);
		case PROVIDERS.ECOFLEET:
			console.log('Creating ECOFLEET Job');
			return await ecofleetMultiJobRequest(ref, request, vehicleSpecs);
		default:
			console.log('Creating STUART Job');
			return await stuartMultiJobRequest(ref, request, vehicleSpecs);
	}
}

async function getClientDetails(apiKey) {
	try {
		return await db.User.findOne({ apiKey: apiKey }, {});
	} catch (err) {
		console.error(err);
		throw err;
	}
}

async function getStuartQuote(reference, params, vehicleSpecs) {
	const {
		pickupAddress,
		pickupPhoneNumber,
		pickupEmailAddress,
		pickupBusinessName,
		pickupFirstName,
		pickupLastName,
		pickupInstructions,
		packagePickupStartTime,
		drops
	} = params;
	const {
		dropoffAddress,
		dropoffPhoneNumber,
		dropoffEmailAddress,
		dropoffBusinessName,
		dropoffFirstName,
		dropoffLastName,
		dropoffInstructions,
		packageDropoffStartTime,
		packageDropoffEndTime
	} = drops[0];
	try {
		const payload = {
			job: {
				...(packagePickupStartTime && { pickup_at: moment(packagePickupStartTime).toISOString() }),
				assignment_code: reference,
				pickups: [
					{
						...pickupSchema,
						address: pickupAddress,
						comment: pickupInstructions,
						contact: {
							firstname: pickupFirstName,
							lastname: pickupLastName,
							phone: pickupPhoneNumber,
							email: pickupEmailAddress,
							company: pickupBusinessName
						}
					}
				],
				dropoffs: [
					{
						...dropoffSchema,
						package_type: vehicleSpecs.stuart.packageType,
						client_reference: genOrderReference(),
						address: dropoffAddress,
						comment: dropoffInstructions,
						contact: {
							firstname: dropoffFirstName,
							lastname: dropoffLastName,
							phone: dropoffPhoneNumber,
							email: dropoffEmailAddress,
							company: dropoffBusinessName
						},
						...(packageDropoffStartTime && { end_customer_time_window_start: packageDropoffStartTime }),
						...(packageDropoffEndTime && { end_customer_time_window_end: packageDropoffEndTime })
					}
				]
			}
		};
		console.log('PAYLOAD');
		console.log('--------------------------');
		console.log({ ...payload.job });
		console.log('--------------------------');
		const priceURL = `${process.env.STUART_ENV}/v2/jobs/pricing`;
		const etaURL = `${process.env.STUART_ENV}/v2/jobs/eta`;
		const price = (await stuartAxios.post(priceURL, payload)).data;
		let data = (await stuartAxios.post(etaURL, payload)).data;
		const quote = {
			...quoteSchema,
			id: `quote_${nanoid(15)}`,
			createdAt: moment().format(),
			expireTime: moment().add(5, 'minutes').format(),
			transport: vehicleSpecs.stuart.vehicleName,
			priceExVAT: price.amount * 1.2,
			currency: price.currency,
			dropoffEta: packagePickupStartTime
				? moment(packagePickupStartTime).add(data.eta, 'seconds').format()
				: moment().add(data.eta, 'seconds').format(),
			providerId: PROVIDERS.STUART
		};
		console.log('STUART QUOTE');
		console.log('----------------------------');
		console.log(quote);
		console.log('----------------------------');
		return quote;
	} catch (err) {
		err.response.data.data && console.log('STUART ERROR:', err.response.data.data);
		if (err.response.status === STUART_ERROR_CODES.UNPROCESSABLE_ENTITY) {
			if (err.response.data.error === STUART_ERROR_CODES.PHONE_INVALID) {
				throw { status: err.response.status, message: err.response.data.message };
			} else if (err.response.data.error === STUART_ERROR_CODES.RECORD_INVALID) {
				if (Object.keys(err.response.data.data).includes('deliveries')) {
					throw { status: err.response.status, message: err.response.data.data['deliveries'][1] };
				} else if (Object.keys(err.response.data.data).includes('job.pickup_at')) {
					throw { status: err.response.status, message: err.response.data.data['job.pickup_at'][0] };
				} else if (Object.keys(err.response.data.data).includes('pickup_at')) {
					throw { status: err.response.status, message: err.response.data.data['pickup_at'][0] };
				}
			} else if (err.response.data.error === STUART_ERROR_CODES.JOB_DISTANCE_NOT_ALLOWED) {
				return null;
			} else {
				throw { status: err.response.status, ...err.response.data };
			}
		} else if (err.response.status === STUART_ERROR_CODES.INVALID_GRANT) {
			throw { status: err.response.status, ...err.response.data };
		} else {
			throw err;
		}
	}
}

async function getGophrQuote(params, vehicleSpecs) {
	const {
		pickupAddressLine1,
		pickupCity,
		pickupPostcode,
		packagePickupStartTime,
		packagePickupEndTime,
		packageDeliveryType,
		parcelWeight,
		drops
	} = params;
	const { dropoffAddressLine1, dropoffCity, dropoffPostcode, packageDropoffStartTime, packageDropoffEndTime } =
		drops[0];
	// get gophr vehicle/package specs
	try {
		const { x: size_x, y: size_y, z: size_z, weight, gophrVehicleType } = vehicleSpecs;
		const payload = qs.stringify({
			api_key: `${process.env.GOPHR_API_KEY}`,
			pickup_address1: pickupAddressLine1,
			pickup_city: pickupCity,
			pickup_postcode: pickupPostcode,
			pickup_country_code: 'GB',
			size_x,
			size_y,
			size_z,
			weight: parcelWeight ? parcelWeight : weight,
			vehicle_type: gophrVehicleType,
			...(packagePickupStartTime && { earliest_pickup_time: moment(packagePickupStartTime).toISOString(true) }),
			...(packagePickupEndTime && { pickup_deadline: moment(packagePickupEndTime).toISOString(true) }),
			...(packageDropoffStartTime && {
				earliest_delivery_time: moment(packageDropoffStartTime).toISOString(true)
			}),
			...(packageDropoffEndTime && {
				delivery_deadline: moment(packageDropoffEndTime).toISOString(true)
			}),
			delivery_address1: dropoffAddressLine1,
			delivery_city: dropoffCity,
			delivery_postcode: dropoffPostcode,
			delivery_country_code: 'GB',
			job_priority: DELIVERY_TYPES[packageDeliveryType].name === DELIVERY_TYPES.ON_DEMAND.name ? 1 : 0
		});
		console.log('PAYLOAD');
		console.log('--------------------------');
		console.log(JSON.parse(JSON.stringify(payload)));
		console.log('--------------------------');
		const config = { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } };
		const quoteURL = `${process.env.GOPHR_ENV}/v1/commercial-api/get-a-quote`;
		let response = (await axios.post(quoteURL, payload, config)).data;
		//error checking
		if (response.success) {
			console.log('RESPONSE');
			console.log('****************************');
			console.log(response.data);
			console.log('****************************');
			let { price_net, delivery_eta } = response.data;
			const quote = {
				...quoteSchema,
				id: `quote_${nanoid(15)}`,
				createdAt: moment().format(),
				transport: vehicleSpecs.name,
				expireTime: moment().add(5, 'minutes').format(),
				priceExVAT: price_net * 1.2,
				currency: 'GBP',
				dropoffEta: moment(delivery_eta).format(),
				providerId: PROVIDERS.GOPHR
			};
			console.log('GOPHR QUOTE');
			console.log('----------------------------');
			console.log(quote);
			console.log('----------------------------');
			return quote;
		} else {
			if (response.error.code === GOPHR_ERROR_CODES.ERROR_MAX_DISTANCE_EXCEEDED) {
				throw { ...response.error, status: 400 };
			} else if (response.error.code === GOPHR_ERROR_CODES.ERROR_SAME_LAT_LNG) {
				throw { ...response.error, status: 400 };
			} else if (response.error.code === GOPHR_ERROR_CODES.INVALID_GRANT) {
				throw { ...response.error, status: 400 };
			} else if (response.error.code === GOPHR_ERROR_CODES.ERROR_DISTANCE) {
				throw { ...response.error, status: 400 };
			} else if (response.error.code === GOPHR_ERROR_CODES.ERROR_PHONE_NUMBER) {
				throw { ...response.error, status: 400 };
			} else if (response.error.code === GOPHR_ERROR_CODES.ERROR_DATETIME_INCORRECT) {
				throw { ...response.error, status: 400 };
			} else if (response.error.code === GOPHR_ERROR_CODES.ERROR_PICKUP_ADDRESS_MISSING) {
				throw { ...response.error, status: 400 };
			} else if (response.error.code === GOPHR_ERROR_CODES.ERROR_DELIVERY_ADDRESS_MISSING) {
				throw { ...response.error, status: 400 };
			} else {
				throw { ...response.error, status: 400 };
			}
		}
	} catch (err) {
		console.error(err);
		throw err;
	}
}

async function getStreetStreamQuote(params, vehicleSpecs) {
	const { pickupPostcode, drops } = params;
	const { dropoffPostcode } = drops[0];
	try {
		const config = {
			headers: { Authorization: `Bearer ${process.env.STREET_STREAM_API_KEY}` },
			params: {
				startPostcode: pickupPostcode,
				endPostcode: dropoffPostcode,
				packageTypeId: vehicleSpecs.streetPackageType
			}
		};
		const quoteURL = `${process.env.STREET_STREAM_ENV}/api/estimate`;
		let data = (await streetStreamAxios.get(quoteURL, config)).data;
		console.log('RESPONSE');
		console.log('****************************');
		console.log(data);
		console.log('****************************');
		const quote = {
			...quoteSchema,
			id: `quote_${nanoid(15)}`,
			createdAt: moment().format(),
			expireTime: moment().add(5, 'minutes').format(),
			priceExVAT: data['estimatedCostVatExclusive'] * 1.2,
			transport: vehicleSpecs.name,
			currency: 'GBP',
			dropoffEta: null,
			providerId: PROVIDERS.STREET_STREAM
		};
		console.log('STREET STREAM QUOTE');
		console.log('----------------------------');
		console.log(quote);
		console.log('----------------------------');
		return quote;
	} catch (err) {
		return null;
	}
}

async function getAddisonLeeQuote(params, vehicleSpecs) {
	const { pickupFormattedAddress, dropoffFormattedAddress, pickupInstructions, dropoffInstructions } = params;
	try {
		const config = { headers: { Authorization: process.env.ADDISON_LEE_API_KEY } };
		const payload = {
			services: [
				{
					code: 'standard_car'
				},
				{
					code: 'large_car'
				}
			],
			locations: [
				{
					street_address: pickupFormattedAddress.street,
					source: 'Address',
					lat: pickupFormattedAddress.latitude,
					long: pickupFormattedAddress.longitude,
					notes: pickupInstructions,
					town: pickupFormattedAddress.city,
					postcode: pickupFormattedAddress.postcode,
					country: pickupFormattedAddress.countryCode
				},
				{
					street_address: dropoffFormattedAddress.street,
					source: 'Address',
					lat: 51.498233,
					long: -0.143448,
					notes: dropoffInstructions,
					town: dropoffFormattedAddress.city,
					postcode: dropoffFormattedAddress.postcode,
					country: dropoffFormattedAddress.countryCode
				}
			]
		};
		const etaURL = `${process.env.ADDISON_LEE_ENV}/api-quickbook/v3/api/quote/time`;
		const priceURL = `${process.env.ADDISON_LEE_ENV}/api-quickbook/v3/api/quote/price`;
		let eta = (await axios.post(etaURL, payload, config)).data;
		let price = (await axios.post(priceURL, payload, config)).data;
		console.log('RESPONSE');
		console.log('****************************');
		console.log({ eta, price });
		console.log('****************************');
		const quote = {
			...quoteSchema,
			id: `quote_${nanoid(15)}`,
			createdAt: moment().format(),
			expireTime: moment().add(5, 'minutes').format(),
			priceExVAT: price,
			currency: 'GBP',
			dropoffEta: eta,
			providerId: PROVIDERS.ADDISON_LEE
		};
		console.log('ADDISON LEE QUOTE');
		console.log('----------------------------');
		console.log(quote);
		console.log('----------------------------');
		return quote;
	} catch (err) {
		throw err;
	}
}

async function stuartJobRequest(ref, params, vehicleSpecs) {
	const {
		pickupAddress,
		pickupPhoneNumber,
		pickupEmailAddress,
		pickupBusinessName,
		pickupFirstName,
		pickupLastName,
		pickupInstructions,
		packagePickupStartTime,
		drops
	} = params;
	console.table(params.drops[0]);
	try {
		const payload = {
			job: {
				...(packagePickupStartTime && { pickup_at: moment(packagePickupStartTime).format() }),
				assignment_code: ref,
				pickups: [
					{
						...pickupSchema,
						address: pickupAddress,
						comment: pickupInstructions,
						contact: {
							firstname: pickupFirstName,
							lastname: pickupLastName,
							phone: pickupPhoneNumber,
							email: pickupEmailAddress,
							company: pickupBusinessName
						}
					}
				],
				dropoffs: [
					{
						...dropoffSchema,
						package_type: vehicleSpecs.stuart.packageType,
						package_description: drops[0].packageDescription,
						client_reference: drops[0].reference,
						address: drops[0].dropoffAddress,
						comment: drops[0].dropoffInstructions,
						contact: {
							firstname: drops[0].dropoffFirstName,
							lastname: drops[0].dropoffLastName,
							phone: drops[0].dropoffPhoneNumber,
							email: drops[0].dropoffEmailAddress,
							company: drops[0].dropoffBusinessName
						},
						...(drops[0].packageDropoffStartTime && {
							end_customer_time_window_start: drops[0].packageDropoffStartTime
						}),
						...(drops[0].packageDropoffEndTime && {
							end_customer_time_window_end: drops[0].packageDropoffEndTime
						})
					}
				]
			}
		};
		console.log(payload.job);
		const priceURL = `${process.env.STUART_ENV}/v2/jobs/pricing`;
		let { amount } = (await stuartAxios.post(priceURL, payload)).data;
		const URL = `${process.env.STUART_ENV}/v2/jobs`;
		let data = (await stuartAxios.post(URL, payload)).data;
		const deliveryInfo = data['deliveries'][0];
		console.log('----------------------------');
		console.log(data);
		console.log(deliveryInfo);
		console.log('----------------------------');
		const delivery = {
			id: deliveryInfo.id,
			orderReference: deliveryInfo['client_reference'],
			description: deliveryInfo['package_description'],
			dropoffStartTime: data['dropoff_at']
				? moment(data['dropoff_at']).format()
				: drops[0].packageDropoffStartTime,
			dropoffEndTime: drops[0].packageDropoffEndTime,
			transport: vehicleSpecs.name,
			dropoffLocation: {
				fullAddress: `${deliveryInfo['dropoff']['address']['street']} ${deliveryInfo['dropoff']['address']['city']} ${deliveryInfo['dropoff']['address']['postcode']}`,
				streetAddress: deliveryInfo['dropoff']['address']['street'],
				city: deliveryInfo['dropoff']['address']['city'],
				postcode: deliveryInfo['dropoff']['address']['postcode'],
				latitude: deliveryInfo['dropoff']['latitude'],
				longitude: deliveryInfo['dropoff']['longitude'],
				country: 'UK',
				phoneNumber: deliveryInfo['dropoff']['contact']['phone'],
				email: deliveryInfo['dropoff']['contact']['email'],
				firstName: deliveryInfo['dropoff']['contact']['firstname'],
				lastName: deliveryInfo['dropoff']['contact']['lastname'],
				businessName: deliveryInfo['dropoff']['contact']['business_name'],
				instructions: deliveryInfo['dropoff']['comment']
			},
			trackingURL: deliveryInfo['tracking_url'],
			status: STATUS.PENDING
		};
		return {
			id: String(data.id),
			deliveryFee:
				process.env.NEW_RELIC_APP_NAME === 'seconds-api' ? data['pricing']['price_tax_included'] : amount * 1.2,
			pickupAt: data['pickup_at'] ? data['pickup_at'] : moment(packagePickupStartTime).format(),
			dropoffAt: data['dropoff_at'] ? data['dropoff_at'] : moment(drops[0].packageDropoffEndTime).format(),
			delivery
		};
	} catch (err) {
		throw err;
	}
}

async function stuartMultiJobRequest(ref, params, vehicleSpecs) {
	const {
		pickupAddress,
		pickupPhoneNumber,
		pickupEmailAddress,
		pickupBusinessName,
		pickupFirstName,
		pickupLastName,
		pickupInstructions,
		packagePickupStartTime,
		drops
	} = params;
	const dropoffs = drops.map(
		({
			dropoffAddress,
			dropoffPhoneNumber,
			dropoffEmailAddress,
			dropoffBusinessName,
			dropoffFirstName,
			dropoffLastName,
			dropoffInstructions,
			packageDropoffStartTime,
			packageDropoffEndTime,
			packageDescription,
			reference
		}) => {
			return {
				...dropoffSchema,
				package_type: vehicleSpecs.stuart.packageType,
				package_description: packageDescription,
				client_reference: reference,
				address: dropoffAddress,
				comment: dropoffInstructions,
				contact: {
					firstname: dropoffFirstName,
					lastname: dropoffLastName,
					phone: dropoffPhoneNumber,
					email: dropoffEmailAddress,
					company: dropoffBusinessName
				},
				...(packageDropoffStartTime && { end_customer_time_window_start: packageDropoffStartTime }),
				...(packageDropoffEndTime && { end_customer_time_window_end: packageDropoffEndTime })
			};
		}
	);
	try {
		const payload = {
			job: {
				...(packagePickupStartTime && { pickup_at: moment(packagePickupStartTime).format() }),
				assignment_code: ref,
				pickups: [
					{
						...pickupSchema,
						address: pickupAddress,
						comment: pickupInstructions,
						contact: {
							firstname: pickupFirstName,
							lastname: pickupLastName,
							phone: pickupPhoneNumber,
							email: pickupEmailAddress,
							company: pickupBusinessName
						}
					}
				],
				dropoffs
			}
		};
		const URL = `${process.env.STUART_ENV}/v2/jobs`;
		let data = (await stuartAxios.post(URL, payload)).data;
		console.log('----------------------------');
		console.log(data);
		console.log('----------------------------');
		let deliveries = data['deliveries'].map(delivery => ({
			id: delivery.id,
			orderReference: delivery.client_reference,
			description: delivery.package_description,
			dropoffStartTime: delivery.eta['dropoff'] ? moment(delivery.eta['dropoff']).format() : data['dropoff_at'],
			dropoffEndTime: delivery.eta['dropoff'] ? moment(delivery.eta['dropoff']).format() : data['dropoff_at'],
			transport: vehicleSpecs.name,
			dropoffLocation: {
				fullAddress: `${delivery['dropoff']['address']['street']} ${delivery['dropoff']['address']['city']} ${delivery['dropoff']['address']['postcode']}`,
				streetAddress: delivery['dropoff']['address']['street'],
				city: delivery['dropoff']['address']['city'],
				postcode: delivery['dropoff']['address']['postcode'],
				latitude: delivery['dropoff']['latitude'],
				longitude: delivery['dropoff']['longitude'],
				country: 'UK',
				phoneNumber: delivery['dropoff']['contact']['phone'],
				email: delivery['dropoff']['contact']['email'],
				firstName: delivery['dropoff']['contact']['firstname'],
				lastName: delivery['dropoff']['contact']['lastname'],
				businessName: delivery['dropoff']['contact']['business_name'],
				instructions: delivery['dropoff']['comment']
			},
			trackingURL: delivery['tracking_url'],
			status: STATUS.PENDING
		}));
		return {
			id: String(data.id),
			deliveryFee: data['pricing']['price_tax_included'],
			pickupAt: data['pickup_at'],
			deliveries,
			providerId: PROVIDERS.STUART
		};
	} catch (err) {
		throw err;
	}
}

async function gophrJobRequest(ref, params, vehicleSpecs) {
	const {
		pickupAddressLine1,
		pickupAddressLine2,
		pickupCity,
		pickupPostcode,
		pickupPhoneNumber,
		pickupEmailAddress,
		pickupBusinessName,
		pickupFirstName,
		pickupLastName,
		pickupInstructions,
		packageDeliveryType,
		packagePickupStartTime,
		packagePickupEndTime,
		parcelWeight,
		drops
	} = params;
	const {
		dropoffAddress,
		dropoffAddressLine1,
		dropoffAddressLine2,
		dropoffCity,
		dropoffPostcode,
		dropoffLatitude,
		dropoffLongitude,
		dropoffPhoneNumber,
		dropoffEmailAddress,
		dropoffBusinessName,
		dropoffFirstName,
		dropoffLastName,
		dropoffInstructions,
		packageDropoffStartTime,
		packageDropoffEndTime,
		packageDescription,
		reference
	} = drops[0];
	try {
		const { x: size_x, y: size_y, z: size_z, weight, gophrVehicleType } = vehicleSpecs;
		const payload = qs.stringify({
			api_key: `${process.env.GOPHR_API_KEY}`,
			external_id: ref,
			reference_number: reference,
			pickup_person_name: `${pickupFirstName} ${pickupLastName}`,
			pickup_mobile_number: `${pickupPhoneNumber}`,
			pickup_company_name: `${pickupBusinessName}`,
			pickup_email: pickupEmailAddress,
			delivery_person_name: `${dropoffFirstName} ${dropoffLastName}`,
			delivery_mobile_number: `${dropoffPhoneNumber}`,
			delivery_company_name: `${dropoffBusinessName}`,
			delivery_email: `${dropoffEmailAddress}`,
			pickup_address1: `${pickupAddressLine1}`,
			...(pickupAddressLine2 && { pickup_address2: `${pickupAddressLine2}` }),
			...(pickupCity && { pickup_city: `${pickupCity}` }),
			pickup_postcode: `${pickupPostcode}`,
			pickup_country_code: 'GB',
			pickup_tips_how_to_find: `${pickupInstructions}`,
			delivery_address1: `${dropoffAddressLine1}`,
			...(dropoffAddressLine2 && { delivery_address2: `${dropoffAddressLine2}` }),
			...(dropoffCity && { delivery_city: `${dropoffCity}` }),
			delivery_postcode: `${dropoffPostcode}`,
			...(packagePickupStartTime && { earliest_pickup_time: moment(packagePickupStartTime).toISOString(true) }),
			...(packagePickupEndTime && { pickup_deadline: moment(packagePickupEndTime).toISOString(true) }),
			...(packageDropoffStartTime && {
				earliest_delivery_time: moment(packageDropoffStartTime).toISOString(true)
			}),
			...(packageDropoffEndTime && { delivery_deadline: moment(packageDropoffEndTime).toISOString(true) }),
			delivery_country_code: 'GB',
			delivery_tips_how_to_find: `${dropoffInstructions}`,
			size_x,
			size_y,
			size_z,
			weight: parcelWeight ? parcelWeight : weight,
			vehicle_type: gophrVehicleType,
			job_priority: DELIVERY_TYPES[packageDeliveryType].name === DELIVERY_TYPES.ON_DEMAND.name ? 1 : 0
		});
		console.log(payload);
		const config = { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } };
		const createJobURL = `${process.env.GOPHR_ENV}/v1/commercial-api/create-confirm-job`;
		const response = (await axios.post(createJobURL, payload, config)).data;
		if (response.success) {
			console.log('RESPONSE');
			console.log('****************************');
			console.log(response.data);
			console.log('****************************');
			const { job_id, public_tracker_url, pickup_eta, delivery_eta, price_gross } = response.data;
			let delivery = {
				id: genDeliveryId(),
				orderReference: drops[0].reference,
				description: packageDescription ? packageDescription : '',
				dropoffStartTime: delivery_eta ? moment(delivery_eta).format() : drops[0].packageDropoffStartTime,
				dropoffEndTime: delivery_eta ? moment(delivery_eta).format() : drops[0].packageDropoffEndTime,
				transport: vehicleSpecs.name,
				dropoffLocation: {
					fullAddress: dropoffAddress,
					streetAddress: dropoffAddressLine1 + dropoffAddressLine2,
					city: dropoffCity,
					postcode: dropoffPostcode,
					country: 'UK',
					latitude: dropoffLatitude,
					longitude: dropoffLongitude,
					phoneNumber: dropoffPhoneNumber,
					email: dropoffEmailAddress ? dropoffEmailAddress : '',
					firstName: dropoffFirstName,
					lastName: dropoffLastName,
					businessName: dropoffBusinessName ? dropoffBusinessName : '',
					instructions: dropoffInstructions ? dropoffInstructions : ''
				},
				trackingURL: public_tracker_url,
				status: STATUS.PENDING
			};
			console.log('DELIVERIES', delivery);
			return {
				id: job_id,
				deliveryFee: price_gross,
				pickupAt: pickup_eta ? pickup_eta : packagePickupStartTime,
				dropoffAt: delivery_eta,
				delivery
			};
		} else {
			// TODO - refactor into its own function
			if (response.error.code === GOPHR_ERROR_CODES.ERROR_MAX_DISTANCE_EXCEEDED) {
				throw { ...response.error, code: 400 };
			} else if (response.error.code === GOPHR_ERROR_CODES.ERROR_SAME_LAT_LNG) {
				throw { ...response.error, code: 400 };
			} else if (response.error.code === GOPHR_ERROR_CODES.INVALID_GRANT) {
				throw { ...response.error, code: 400 };
			} else if (response.error.code === GOPHR_ERROR_CODES.ERROR_DISTANCE) {
				throw { ...response.error, code: 400 };
			} else if (response.error.code === GOPHR_ERROR_CODES.ERROR_PHONE_NUMBER) {
				throw { ...response.error, code: 400 };
			} else if (response.error.code === GOPHR_ERROR_CODES.ERROR_DATETIME_INCORRECT) {
				throw { ...response.error, code: 400 };
			} else if (response.error.code === GOPHR_ERROR_CODES.ERROR_PICKUP_ADDRESS_MISSING) {
				throw { ...response.error, code: 400 };
			} else if (response.error.code === GOPHR_ERROR_CODES.ERROR_DELIVERY_ADDRESS_MISSING) {
				throw { ...response.error, code: 400 };
			} else {
				throw { ...response.error, code: 400 };
			}
		}
	} catch (err) {
		throw err;
	}
}

async function streetStreamJobRequest(ref, strategy, params, vehicleSpecs) {
	console.table(params);
	const {
		pickupAddressLine1,
		pickupAddressLine2,
		pickupCity,
		pickupPostcode,
		pickupPhoneNumber,
		pickupFirstName,
		pickupLastName,
		pickupInstructions,
		packagePickupStartTime,
		packagePickupEndTime,
		drops
	} = params;
	const {
		dropoffAddressLine1,
		dropoffAddressLine2,
		dropoffCity,
		dropoffPostcode,
		dropoffPhoneNumber,
		dropoffFirstName,
		dropoffLastName,
		dropoffInstructions,
		packageDropoffStartTime,
		packageDropoffEndTime,
		reference
	} = drops[0];
	try {
		const payload = {
			offerAcceptanceStrategy:
				strategy === SELECTION_STRATEGIES.RATING
					? STRATEGIES.AUTO_HIGHEST_RATED_COURIER
					: STRATEGIES.AUTO_CLOSEST_COURIER_TO_ME,
			courierTransportType: vehicleSpecs.streetVehicleType,
			jobLabel: ref,
			insuranceCover: 'PERSONAL',
			submitForQuotesImmediately: true,
			pickUp: {
				contactNumber: pickupPhoneNumber,
				contactName: `${pickupFirstName} ${pickupLastName}`,
				addressOne: pickupAddressLine1 + pickupAddressLine2,
				city: pickupCity,
				postcode: pickupPostcode,
				pickUpNotes: pickupInstructions,
				pickUpFrom: moment(packagePickupStartTime).add(30, 'minutes').toISOString(true),
				pickUpTo: packagePickupEndTime
					? moment(packagePickupEndTime).add(30, 'minutes').toISOString(true)
					: moment(packagePickupStartTime).add(40, 'minutes').toISOString(true)
			},
			dropOff: {
				contactNumber: dropoffPhoneNumber,
				contactName: `${dropoffFirstName} ${dropoffLastName}`,
				addressOne: dropoffAddressLine1 + dropoffAddressLine2,
				city: dropoffCity,
				postcode: dropoffPostcode,
				dropOffFrom: packageDropoffStartTime
					? moment(packageDropoffStartTime).add(30, 'minutes').toISOString(true)
					: moment(packagePickupStartTime).add(30, 'minutes').toISOString(true),
				dropOffTo: moment(packageDropoffEndTime).add(30, 'minutes').toISOString(true),
				clientTag: reference,
				deliveryNotes: dropoffInstructions
			}
		};
		console.log('-------------------------------------------');
		console.log('Payload');
		console.log(payload);
		console.log('---------------------------------------------');
		const createJobURL = `${process.env.STREET_STREAM_ENV}/api/job/pointtopoint`;
		const data = (await streetStreamAxios.post(createJobURL, payload)).data;
		console.log(data);
		const delivery = {
			id: data['dropOff'].id,
			orderReference: data['dropOff'].clientTag,
			description: data['dropOff']['dropOffNotes'],
			dropoffStartTime: data['dropOff']['dropOffFrom']
				? moment(data['dropOff']['dropOffFrom']).format()
				: drops[0].packageDropoffStartTime,
			dropoffEndTime: data['dropOff']['dropOffTo']
				? moment(data['dropOff']['dropOffTo']).format()
				: drops[0].packageDropoffEndTime,
			transport: vehicleSpecs.name,
			dropoffLocation: {
				fullAddress: drops[0].dropoffAddress,
				streetAddress: data['dropOff']['addressOne'] + data['dropOff']['addressTwo'],
				city: data['dropOff']['city'],
				postcode: data['dropOff']['postcode'],
				country: 'UK',
				latitude: data['dropOff']['latitude'],
				longitude: data['dropOff']['longitude'],
				phoneNumber: data['dropOff']['contactNumber'],
				email: drops[0].dropoffEmailAddress ? drops[0].dropoffEmailAddress : '',
				firstName: drops[0].dropoffFirstName,
				lastName: drops[0].dropoffLastName,
				businessName: drops[0].dropoffBusinessName ? drops[0].dropoffBusinessName : '',
				instructions: drops[0].dropoffInstructions ? drops[0].dropoffInstructions : ''
			},
			trackingURL: '',
			status: STATUS.PENDING
		};
		return {
			id: data.id,
			trackingURL: null,
			deliveryFee: data['jobCharge']['totalPayableWithVat'],
			pickupAt: data.pickUp['pickUpFrom'] ? moment(data.pickUp['pickUpFrom']).format() : packagePickupStartTime,
			dropoffAt: packageDropoffEndTime
				? moment(packageDropoffEndTime).format()
				: moment(packagePickupStartTime).add(data['estimatedRouteTimeSeconds'], 'seconds').format(),
			delivery
		};
	} catch (err) {
		throw err;
	}
}

async function streetStreamMultiJobRequest(ref, strategy, params, vehicleSpecs) {
	const {
		pickupAddressLine1,
		pickupAddressLine2,
		pickupCity,
		pickupPostcode,
		pickupPhoneNumber,
		pickupFirstName,
		pickupLastName,
		pickupInstructions,
		packagePickupStartTime,
		packagePickupEndTime,
		drops
	} = params;

	let lastDropoffTime = moment().toISOString(true);
	const dropoffs = drops.map(drop => {
		if (moment(drop.packageDropoffEndTime).diff(lastDropoffTime) > 0)
			lastDropoffTime = moment(drop.packageDropoffEndTime).add(30, 'minutes').toISOString(true);
		return {
			contactNumber: drop.dropoffPhoneNumber,
			contactName: `${drop.dropoffFirstName} ${drop.dropoffLastName}`,
			addressOne: drop.dropoffAddressLine1,
			...(drop['dropoffAddressLine2'] && { addressTwo: drop['dropoffAddressLine2'] }),
			city: drop.dropoffCity,
			postcode: drop.dropoffPostcode,
			clientTag: drop.reference,
			deliveryNotes: drop.dropoffInstructions
		};
	});
	console.log('LAST Dropoff Time:', lastDropoffTime);
	try {
		const payload = {
			offerAcceptanceStrategy:
				strategy === SELECTION_STRATEGIES.RATING
					? STRATEGIES.AUTO_HIGHEST_RATED_COURIER
					: STRATEGIES.AUTO_CLOSEST_COURIER_TO_ME,
			courierTransportType: vehicleSpecs.streetVehicleType,
			jobLabel: ref,
			insuranceCover: 'PERSONAL',
			submitForQuotesImmediately: true,
			optimiseRoute: true,
			deliveryFrom: moment(packagePickupStartTime).toISOString(true),
			deliveryTo: lastDropoffTime,
			pickUp: {
				contactNumber: pickupPhoneNumber,
				contactName: `${pickupFirstName} ${pickupLastName}`,
				addressOne: pickupAddressLine1 + pickupAddressLine2,
				city: pickupCity,
				postcode: pickupPostcode,
				pickUpNotes: pickupInstructions,
				pickUpFrom: moment(packagePickupStartTime).add(30, 'minutes').toISOString(true),
				pickUpTo: packagePickupEndTime
					? moment(packagePickupEndTime).add(30, 'minutes').toISOString(true)
					: moment(packagePickupStartTime).add(40, 'minutes').toISOString(true)
			},
			drops: dropoffs
		};
		console.log('---------------------------------------');
		console.log('PAYLOAD');
		console.log(payload);
		console.log('---------------------------------------');
		const multiJobURL = `${process.env.STREET_STREAM_ENV}/api/job/multidrop`;
		const response = await streetStreamAxios.post(multiJobURL, payload);
		if (response.data) {
			let { data } = response;
			let deliveries = data['drops'].map((delivery, index) => ({
				id: delivery.id,
				orderReference: delivery.clientTag,
				description: delivery['deliveryNotes'],
				dropoffStartTime: delivery['dropOffFrom']
					? moment(delivery['dropOffFrom']).format()
					: drops[index].packageDropoffStartTime,
				dropoffEndTime: delivery['dropOffTo']
					? moment(delivery['dropOffTo']).format()
					: drops[index].packageDropoffEndTime,
				transport: vehicleSpecs.name,
				dropoffLocation: {
					fullAddress: drops[index].dropoffAddress,
					streetAddress: delivery['addressOne'] + delivery['addressTwo'] ? delivery['addressTwo'] : '',
					city: delivery['city'],
					postcode: delivery['postcode'],
					country: 'UK',
					latitude: delivery['latitude'],
					longitude: delivery['longitude'],
					phoneNumber: delivery['contactNumber'],
					email: drops[index].dropoffEmailAddress ? drops[index].dropoffEmailAddress : '',
					firstName: drops[index].dropoffFirstName,
					lastName: drops[index].dropoffLastName,
					businessName: drops[index].dropoffBusinessName ? drops[index].dropoffBusinessName : '',
					instructions: drops[index].dropoffInstructions ? drops[index].dropoffInstructions : ''
				},
				trackingURL: '',
				status: STATUS.PENDING
			}));
			return {
				id: data.id,
				deliveryFee: data['jobCharge']['totalPayableWithVat'],
				pickupAt: data['pickUp']['pickUpFrom'] ? data['pickUp']['pickUpFrom'] : packagePickupStartTime,
				deliveries,
				providerId: PROVIDERS.STREET_STREAM
			};
		} else {
			throw new Error('There was an issue creating your multi drop with street stream');
		}
	} catch (err) {
		console.error(err);
		throw err;
	}
}

async function ecofleetJobRequest(refNumber, params, vehicleSpecs) {
	const {
		pickupAddressLine1,
		pickupAddressLine2,
		pickupCity,
		pickupPostcode,
		pickupPhoneNumber,
		pickupEmailAddress,
		pickupBusinessName,
		pickupFirstName,
		pickupLastName,
		pickupInstructions,
		packageDeliveryType,
		packagePickupStartTime,
		packageDescription,
		vehicleType,
		drops
	} = params;

	const {
		dropoffAddress,
		dropoffAddressLine1,
		dropoffAddressLine2,
		dropoffCity,
		dropoffPostcode,
		dropoffPhoneNumber,
		dropoffEmailAddress,
		dropoffBusinessName,
		dropoffFirstName,
		dropoffLastName,
		dropoffInstructions,
		dropoffLatitude,
		dropoffLongitude,
		packageDropoffEndTime
	} = drops[0];

	const payload = {
		pickup: {
			name: `${pickupFirstName} ${pickupLastName}`,
			company_name: pickupBusinessName,
			address_line1: pickupAddressLine1,
			...(pickupAddressLine2 && { address_line2: pickupAddressLine2 }),
			city: pickupCity,
			postal: pickupPostcode,
			country: 'England',
			phone: pickupPhoneNumber,
			email: pickupEmailAddress,
			comment: pickupInstructions
		},
		drops: [
			{
				name: `${dropoffFirstName} ${dropoffLastName}`,
				company_name: dropoffBusinessName,
				address_line1: dropoffAddressLine1,
				...(dropoffAddressLine2 && { address_line2: dropoffAddressLine2 }),
				city: dropoffCity,
				postal: dropoffPostcode,
				country: 'England',
				phone: dropoffPhoneNumber,
				email: dropoffEmailAddress,
				comment: dropoffInstructions
			}
		],
		parcel: {
			weight: VEHICLE_CODES_MAP[vehicleType].weight,
			type: packageDescription ? packageDescription : ''
		},
		schedule: {
			type: DELIVERY_TYPES[packageDeliveryType].ecofleet,
			...(packagePickupStartTime && { pickupWindow: moment(packagePickupStartTime).unix() }),
			...(packageDropoffEndTime && { dropoffWindow: moment(packageDropoffEndTime).unix() })
		}
	};
	console.log(payload);
	try {
		const config = { headers: { Authorization: `Bearer ${process.env.ECOFLEET_API_KEY}` } };
		const createJobURL = `${process.env.ECOFLEET_ENV}/api/v1/order`;
		const data = (await axios.post(createJobURL, payload, config)).data;
		console.log(data);
		let delivery = {
			id: data.id,
			orderReference: drops[0].reference,
			description: packageDescription ? packageDescription : '',
			dropoffStartTime: drops[0].packageDropoffStartTime,
			dropoffEndTime: drops[0].packageDropoffEndTime,
			transport: vehicleSpecs.name,
			dropoffLocation: {
				fullAddress: dropoffAddress,
				streetAddress: dropoffAddressLine1 + dropoffAddressLine2,
				city: dropoffCity,
				postcode: dropoffPostcode,
				latitude: dropoffLatitude,
				longitude: dropoffLongitude,
				country: 'UK',
				phoneNumber: dropoffPhoneNumber,
				email: dropoffEmailAddress ? dropoffEmailAddress : '',
				firstName: dropoffFirstName,
				lastName: dropoffLastName,
				businessName: dropoffBusinessName ? dropoffBusinessName : '',
				instructions: dropoffInstructions ? dropoffInstructions : ''
			},
			trackingURL: data.tasks[0]['tracking_link'],
			status: STATUS.PENDING
		};
		return {
			id: data.id,
			trackingURL: null,
			deliveryFee: data['amount'],
			pickupAt: packagePickupStartTime ? moment(packagePickupStartTime).format() : undefined,
			delivery
		};
	} catch (err) {
		throw err;
	}
}

async function ecofleetMultiJobRequest(refNumber, params, vehicleSpecs) {
	const {
		pickupAddressLine1,
		pickupAddressLine2,
		pickupCity,
		pickupPostcode,
		pickupPhoneNumber,
		pickupEmailAddress,
		pickupBusinessName,
		pickupFirstName,
		pickupLastName,
		pickupInstructions,
		packageDeliveryType,
		packagePickupStartTime,
		packageDescription,
		vehicleType,
		drops
	} = params;

	const dropoffs = drops.map(drop => ({
		name: `${drop.dropoffFirstName} ${drop.dropoffLastName}`,
		company_name: drop.dropoffBusinessName,
		address_line1: drop.dropoffAddressLine1,
		...(drop['dropoffAddressLine2'] && { address_line2: drop['dropoffAddressLine2'] }),
		city: drop.dropoffCity,
		postal: drop.dropoffPostcode,
		country: 'England',
		phone: drop.dropoffPhoneNumber,
		email: drop.dropoffEmailAddress,
		comment: drop.dropoffInstructions
	}));

	const payload = {
		pickup: {
			name: `${pickupFirstName} ${pickupLastName}`,
			company_name: pickupBusinessName,
			address_line1: pickupAddressLine1,
			...(pickupAddressLine2 && { address_line2: pickupAddressLine2 }),
			city: pickupCity,
			postal: pickupPostcode,
			country: 'England',
			phone: pickupPhoneNumber,
			email: pickupEmailAddress,
			comment: pickupInstructions
		},
		drops: dropoffs,
		parcel: {
			weight: VEHICLE_CODES_MAP[vehicleType].weight,
			type: packageDescription ? packageDescription : ''
		},
		schedule: {
			type: DELIVERY_TYPES[packageDeliveryType].ecofleet,
			...(packagePickupStartTime && { pickupWindow: moment(packagePickupStartTime).unix() })
			// ...(drops[0].packageDropoffStartTime && { dropoffWindow: moment(drops[0].packageDropoffStartTime).unix() })
		}
	};
	console.log(payload);
	try {
		const config = { headers: { Authorization: `Bearer ${process.env.ECOFLEET_API_KEY}` } };
		const createJobURL = `${process.env.ECOFLEET_ENV}/api/v1/order`;
		const data = (await axios.post(createJobURL, payload, config)).data;
		console.log(data);
		data.tasks.shift();
		let deliveries = data.tasks.map((task, index) => ({
			id: task.id,
			orderReference: drops[index].reference,
			description: drops[index].packageDescription ? drops[index].packageDescription : '',
			dropoffStartTime: drops[index].packageDropoffStartTime,
			dropoffEndTime: drops[index].packageDropoffEndTime,
			transport: vehicleSpecs.name,
			dropoffLocation: {
				fullAddress: drops[index].dropoffAddress,
				streetAddress: task.address,
				city: task.city,
				postcode: task.postal,
				country: 'UK',
				latitude: drops[index].dropoffLatitude,
				longitude: drops[index].dropoffLongitude,
				phoneNumber: task.phone,
				email: task.email ? task.email : '',
				firstName: drops[index].dropoffFirstName,
				lastName: drops[index].dropoffLastName,
				businessName: drops[index].dropoffBusinessName ? drops[index].dropoffBusinessName : '',
				instructions: task.comment ? task.comment : ''
			},
			trackingURL: task['tracking_link'],
			status: STATUS.PENDING
		}));
		return {
			id: data.id,
			deliveryFee: data['amount'],
			pickupAt: packagePickupStartTime ? moment(packagePickupStartTime).format() : undefined,
			deliveries,
			providerId: PROVIDERS.ECOFLEET
		};
	} catch (err) {
		throw err;
	}
}

async function addisonLeeJobRequestWithQuote(quoteId, params, vehicleSpecs) {
	try {
		const config = { headers: { Authorization: process.env.ADDISON_LEE_API_KEY } };
		const payload = {
			pickup_dt: '2019-10-01T09:00:00+01:00',
			request_id: '616ed1b9-cf2f-4eec-bbdf-634368c9e070',
			quote_id: quoteId,
			promo_code: 'DISCOUNT10',
			payment_method: 'Account',
			service: 'standard_car',
			contact: {
				name: 'John Doe',
				mobile: '07123456789',
				email: 'john.doe@example.com'
			},
			passengers: [
				{
					name: 'Jane Doe',
					mobile: '07262555555',
					email: 'jane.doe@example.com'
				},
				{
					name: 'Jane Smith',
					mobile: '07123456789',
					email: 'jane.smith@example.com'
				}
			],
			information: [
				{
					type: 'Notes',
					value: 'Special Instruction Notes'
				},
				{
					type: 'Description',
					value: 'Addison Lee to Collect John Doe'
				}
			],
			partner_reference: {
				booking: {
					id: '9d8760a1-84cb-42d5-8887-f9574e75ede7',
					number: '345677'
				}
			}
		};
		const etaURL = `${process.env.ADDISON_LEE_ENV}/api-quickbook/v3/api/quote/time`;
		const priceURL = `${process.env.ADDISON_LEE_ENV}/api-quickbook/v3/api/quote/price`;
		let eta = (await axios.post(etaURL, payload, config)).data;
		let price = (await axios.post(priceURL, payload, config)).data;
		console.log('RESPONSE');
		console.log('****************************');
		console.log({ eta, price });
		console.log('****************************');
		const quote = {
			...quoteSchema,
			id: `quote_${nanoid(15)}`,
			createdAt: moment().format(),
			expireTime: moment().add(5, 'minutes').format(),
			priceExVAT: price,
			currency: 'GBP',
			dropoffEta: eta,
			providerId: PROVIDERS.ADDISON_LEE
		};
		console.log('ADDISON LEE QUOTE');
		console.log('----------------------------');
		console.log(quote);
		console.log('----------------------------');
		return quote;
	} catch (err) {
		throw err;
	}
}

async function sendCancellationRequest(jobId, provider, job, comment) {
	try {
		const user = await db.User.findById(job.clientId);
		let options = {
			name: `${user.firstname} ${user.lastname}`,
			email: `chipzstar.dev@gmail.com`,
			templateId: 'd-90f8f075032e4d4b90fc595ad084d2a6',
			templateData: {
				client_reference: `${job.jobSpecification.deliveries[0].orderReference}`,
				customer: `${job.jobSpecification.deliveries[0].dropoffLocation.firstName} ${job.jobSpecification.deliveries[0].dropoffLocation.lastName}`,
				pickup: `${job.jobSpecification.pickupLocation.fullAddress}`,
				dropoff: `${job.jobSpecification.deliveries[0].dropoffLocation.fullAddress}`,
				reason: comment ? comment : `Requested by User`,
				cancelled_by: `${user.firstname} ${user.lastname}`,
				provider: provider
			}
		};
		await sendEmail(options);
		return 'Cancellation request sent';
	} catch (e) {
		throw e;
	}
}

async function stuartCancelRequest(jobId, comment) {
	try {
		const URL = `${process.env.STUART_ENV}/v2/jobs/${jobId}/cancel`;
		const payload = {
			public_reason_key: 'customer_cancellation_requested',
			comment
		};
		const res = (await stuartAxios.post(URL, payload)).data;
		return 'Your job has been cancelled by Stuart!';
	} catch (err) {
		throw err;
	}
}

async function gophrCancelRequest(jobId, comment) {
	try {
		const cancelURL = `${process.env.GOPHR_ENV}/v1/commercial-api/cancel-job`;
		const costURL = `${process.env.GOPHR_ENV}/v1/commercial-api/get-cancelation-cost`;
		const payload = qs.stringify({
			api_key: `${process.env.GOPHR_API_KEY}`,
			job_id: `${jobId}`
		});
		let response = (await axios.post(costURL, payload)).data;
		console.log(response);
		console.log(response['cancelation_cost']);
		response = (await axios.post(cancelURL, payload)).data;
		console.log(response);
		return 'Your job has been cancelled by Gohpr!';
	} catch (err) {
		throw err;
	}
}

async function cancelDriverJob(jobId, job, comment) {
	try {
		const user = await db.User.findById(job.clientId);
		const driver = await db.Driver.findOne({ clientIds: job.clientId });
		let template = `Order ${job.jobSpecification.orderNumber} to ${job.jobSpecification.deliveries[0].dropoffLocation.fullAddress} has been cancelled by ${user.company}.`;
		driver &&
			sendSMS(driver.phone, template, { smsCommission: user['subscriptionItems'].smsCommission }, true).then(() =>
				console.log('sms sent successfully')
			);
		return 'Order cancelled successfully';
	} catch (err) {
		throw err;
	}
}

async function cancelOrder(jobId, provider, jobDetails, comment = '') {
	switch (provider) {
		case PROVIDERS.STUART:
			console.log('Cancelling STUART Job');
			return await stuartCancelRequest(jobId, comment);
		case PROVIDERS.GOPHR:
			console.log('Cancelling GOPHR Job');
			return await gophrCancelRequest(jobId, comment);
		case PROVIDERS.PRIVATE:
			console.log('Cancelling PRIVATE Job');
			return await cancelDriverJob(jobId, jobDetails, comment);
		// default case if the provider does not support cancellation via API
		default:
			console.log('Sending cancellation request');
			return await sendCancellationRequest(jobId, provider, jobDetails, comment);
	}
}

async function sendNewJobEmails(team, job, canSend = true) {
	console.log('TEAM');
	team.forEach(member => console.table(member));
	try {
		return await Promise.all(
			team.map(
				async ({ name, email }) =>
					await sendEmail(
						{
							email: email,
							name: name,
							subject: 'New delivery job',
							templateId: 'd-aace035dda44493e8cc507c367da3a03',
							templateData: {
								address: job.jobSpecification.deliveries[0].dropoffLocation.fullAddress,
								customer: `${job.jobSpecification.deliveries[0].dropoffLocation.firstName} ${job.jobSpecification.deliveries[0].dropoffLocation.lastName}`,
								provider: job.selectedConfiguration.providerId,
								reference: job.jobSpecification.jobReference,
								price: `£${Number(job.selectedConfiguration.deliveryFee).toFixed(2)}`,
								created_at: moment(job.createdAt).format('DD/MM/YYYY HH:mm:ss'),
								eta: job.jobSpecification.pickupStartTime
									? moment(job.jobSpecification.pickupStartTime).calendar()
									: 'N/A',
								unsubscribe: 'https://useseconds.com'
							}
						},
						canSend
					)
			)
		);
	} catch (err) {
		console.error(err.response ? err.response.body : err);
	}
}

async function geocodeAddress(address) {
	try {
		const response = (
			await GMapsClient.geocode({
				params: {
					address,
					key: process.env.GOOGLE_MAPS_API_KEY
				}
			})
		).data;

		if (response.results.length) {
			const formattedAddress = {
				street: '',
				city: '',
				postcode: '',
				latitude: response.results[0].geometry.location.lat,
				longitude: response.results[0].geometry.location.lng
			};
			let fullAddress = response.results[0].formatted_address;
			let components = response.results[0].address_components;
			console.log(components);
			components.forEach(({ long_name, types }) => {
				switch (types[0]) {
					case 'street_number':
						formattedAddress.street = formattedAddress.street + long_name;
						break;
					case 'route':
						formattedAddress.street = formattedAddress.street + ' ' + long_name;
						break;
					case 'postal_town':
						formattedAddress.city = long_name;
						break;
					case 'postal_code':
						formattedAddress.postcode = long_name;
						break;
					default:
						break;
				}
			});
			return { fullAddress, formattedAddress };
		}
		throw new Error('No Address suggestions found');
	} catch (e) {
		console.error(e);
		throw e;
	}
}

function convertWeightToVehicleCode(total_weight) {
	console.log('Total Weight:', total_weight, 'kg');
	let vehicleName;
	let vehicleCode;
	for (let code of VEHICLE_CODES) {
		console.log('switching vehicle...');
		const { name, weight } = VEHICLE_CODES_MAP[code];
		console.table({ code, name, weight });
		vehicleCode = code;
		vehicleName = name;
		if (total_weight < weight) break;
	}
	return { vehicleName, vehicleCode };
}

async function sendWebhookUpdate(payload, topic) {
	try {
		const clientId = payload.clientId;
		const webhook = await db.Webhook.findOne({ clientId });
		/*console.log('---------------------------------');
		console.log('WEBHOOK:', webhook ? webhook.webhookId : webhook);*/
		// check if the current webhook topic is listed under the client's webhook topic list
		if (webhook && Array.from(webhook.topics).includes(topic) && !webhook.isBroken) {
			const signature = generateSignature(payload, webhook.secret);
			/*console.log('SIGNATURE:', signature);*/
			const config = {
				headers: {
					'x-seconds-signature': signature
				}
			};
			// send request to client's endpoint
			await webhookAxios.post(webhook.endpointURL, payload, config);
			// update the lastUsed property of the webhook to current timestamp
			webhook.update({ lastUsed: moment().toISOString(true) });
			await webhook.save();
		}
		/*console.log('---------------------------------');*/
		return true;
	} catch (err) {
		console.error(err);
		throw err;
	}
}

function generateSignature(payload, secret) {
	const payloadBase64 = Buffer.from(JSON.stringify(payload)).toString('base64').replace(/=/g, '');
	return Base64.stringify(HmacSHA256(payloadBase64, secret));
}

function calculateNextHourlyBatch(pickupDate, deliveryHours, { batchInterval }) {
	const dayOfWeek = pickupDate.day();
	const openTime = moment(deliveryHours[dayOfWeek].open);
	let canDeliver = deliveryHours[dayOfWeek].canDeliver;
	let nextBatchTime = openTime.clone();
	// loop over every <INTERVAL> hours from the store open time for current day
	// stop when the batch time is after the time scheduled for pickup AND store can deliver on the batch day
	while (nextBatchTime.isBefore(pickupDate) || !canDeliver) {
		console.table({ NEXT_BATCH_TIME: nextBatchTime.format() });
		// if calculated next batch time is in the PAST, add <INTERVAL> hours
		nextBatchTime.add(batchInterval, 'hours');
		// check if the new batch time is within the store's delivery hours
		canDeliver = checkPickupHours(nextBatchTime.format(), deliveryHours);
		if (!canDeliver) {
			nextBatchTime = moment(setNextDayDeliveryTime(nextBatchTime.format(), deliveryHours).nextDayPickup);
		}
	}
	return nextBatchTime;
}

async function finaliseJob(user, job, clientId, commissionCharge, driver = null, settings = null, smsEnabled = false) {
	try {
		// Create the final job into the jobs database
		const createdJob = await db.Job.create({ ...job, clientId, commissionCharge });
		console.log(createdJob);
		let {
			dropoffLocation: { phoneNumber }
		} = job.jobSpecification.deliveries[0];
		await sendNewJobEmails(user.team, job, settings.jobAlerts.new);
		const trackingMessage = `\n\nTrack your delivery here: ${process.env.TRACKING_BASE_URL}/${createdJob._id}`;
		const template = `Your ${user.company} order has been created and accepted. The driver will pick it up shortly and delivery will be attempted today. ${trackingMessage}`;
		await sendSMS(phoneNumber, template, user.subscriptionItems, smsEnabled);
		if (job.selectedConfiguration.providerId === PROVIDERS.PRIVATE && driver && settings) {
			setTimeout(
				() => checkJobExpired(job.jobSpecification.orderNumber, driver, user, settings),
				settings['driverResponseTime'] * 60000
			);
		}
		const title = `New order!`;
		const contentDriver = ` and assigned to your driver`;
		const contentCourier = ` and dispatched to ${job.selectedConfiguration.providerId}`;
		const content = `Order ${job.jobSpecification.orderNumber} has been created`.concat(
			job.selectedConfiguration.providerId === PROVIDERS.UNASSIGNED
				? '!'
				: driver
				? contentDriver
				: contentCourier
		);
		console.log('************************************************');
		console.log(content);
		sendNotification(clientId, title, content).then(() => console.log('notification sent!'));
		return createdJob;
	} catch (err) {
		console.error(err);
		throw err
	}
}

function dailyBatchOrder(payload, settings, deliveryHours, jobReference, vehicleSpecs, ecommerceIds) {
	let job;
	let pickupStartTime;
	let dropoffEndTime;
	console.log('-------------------------------------------------------');
	console.log(Number(settings.autoBatch.daily.deadline.slice(0, 2)));
	console.log(Number(settings.autoBatch.daily.deadline.slice(3)));
	console.log('-------------------------------------------------------');
	console.log(Number(settings.autoBatch.daily.pickupTime.slice(0, 2)));
	console.log(Number(settings.autoBatch.daily.pickupTime.slice(3)));
	console.log('-------------------------------------------------------');
	// check if the order is scheduled for same day (day of the month should be equal)
	if (moment(payload.packagePickupStartTime).date() === moment().date()) {
		let batchDeadline = moment()
			.set('hour', Number(settings.autoBatch.daily.deadline.slice(0, 2)))
			.set('minute', Number(settings.autoBatch.daily.deadline.slice(3)))
			.set('second', 0);
		let batchPickupTime = moment(batchDeadline)
			.set('hour', Number(settings.autoBatch.daily.pickupTime.slice(0, 2)))
			.set('minute', Number(settings.autoBatch.daily.pickupTime.slice(3)))
			.set('second', 0);
		let batchDropoffTime = moment(batchPickupTime).set('hour', 21).set('minute', 0);

		console.table({ batchDeadline: batchDeadline.format(), batchPickupTime: batchPickupTime.format() });
		// if same day, check if order creation time is before the daily batch deadline
		if (moment().isBefore(batchDeadline)) {
			pickupStartTime = batchPickupTime.format();
			dropoffEndTime = batchDropoffTime.format();
		} else {
			// check the store delivery hours for the next available day
			let newBatchPickupTime = batchPickupTime.add(1, 'd');
			let canDeliver = checkPickupHours(newBatchPickupTime, deliveryHours);
			if (!canDeliver) {
				// if can't deliver, fetch the next available delivery date
				const { nextDayPickup, nextDayDropoff } = setNextDayDeliveryTime(newBatchPickupTime, deliveryHours);
				payload.packageDeliveryType = DELIVERY_TYPES.NEXT_DAY.name;
				pickupStartTime = moment(nextDayPickup)
					.set('hour', Number(settings.autoBatch.daily.pickupTime.slice(0, 2)))
					.set('minute', Number(settings.autoBatch.daily.pickupTime.slice(3)))
					.set('second', 0)
					.format();
				dropoffEndTime = moment(nextDayDropoff).set('hour', 21).set('minute', 0).format();
			}
			// if can delivery,
			// set the pickupTime to daily batch pickup time for tomorrow
			// set dropoff time at 9pm tomorrow
			pickupStartTime = newBatchPickupTime.format();
			dropoffEndTime = moment(newBatchPickupTime).set('hour', 21).set('minute', 0).format();
		}
		// if order is not scheduled for same-day
	} else {
		pickupStartTime = moment(payload.packagePickupStartTime)
			.set('hour', Number(settings.autoBatch.daily.pickupTime.slice(0, 2)))
			.set('minute', Number(settings.autoBatch.daily.pickupTime.slice(3)))
			.format();
		dropoffEndTime = moment(payload.drops[0].packageDropoffEndTime).set('hour', 21).set('minute', 0).format();
	}
	console.table({ pickupStartTime, dropoffEndTime });
	job = {
		createdAt: moment().format(),
		driverInformation: {
			name: `NO DRIVER ASSIGNED`,
			phone: '',
			transport: ''
		},
		jobSpecification: {
			id: genDeliveryId(),
			jobReference: jobReference,
			orderNumber: orderId.generate(),
			...ecommerceIds,
			deliveryType: payload.packageDeliveryType,
			pickupStartTime,
			pickupEndTime: payload.packagePickupEndTime,
			pickupLocation: {
				fullAddress: payload.pickupAddress,
				streetAddress: String(payload.pickupAddressLine1).trim(),
				city: String(payload.pickupCity).trim(),
				postcode: String(payload.pickupPostcode).trim(),
				latitude: payload.pickupLatitude,
				longitude: payload.pickupLongitude,
				country: 'UK',
				phoneNumber: payload.pickupPhoneNumber,
				email: payload.pickupEmailAddress,
				firstName: payload.pickupFirstName,
				lastName: payload.pickupLastName,
				businessName: payload.pickupBusinessName,
				instructions: payload.pickupInstructions
			},
			deliveries: [
				{
					id: genDeliveryId(),
					orderReference: payload.drops[0]['reference'],
					description: payload.drops[0]['packageDescription'],
					dropoffEndTime,
					transport: vehicleSpecs.name,
					dropoffLocation: {
						fullAddress: payload.drops[0].dropoffAddress,
						streetAddress: payload.drops[0].dropoffAddressLine1 + payload.drops[0].dropoffAddressLine2,
						city: payload.drops[0].dropoffCity,
						postcode: payload.drops[0].dropoffPostcode,
						country: 'UK',
						latitude: payload.drops[0].dropoffLatitude,
						longitude: payload.drops[0].dropoffLongitude,
						phoneNumber: payload.drops[0].dropoffPhoneNumber,
						email: payload.drops[0].dropoffEmailAddress,
						firstName: payload.drops[0].dropoffFirstName,
						lastName: payload.drops[0].dropoffLastName,
						businessName: payload.drops[0].dropoffBusinessName ? payload.drops[0].dropoffBusinessName : '',
						instructions: payload.drops[0].dropoffInstructions ? payload.drops[0].dropoffInstructions : ''
					},
					trackingURL: '',
					status: STATUS.NEW
				}
			]
		},
		selectedConfiguration: {
			createdAt: moment().format(),
			deliveryFee: settings ? settings.driverDeliveryFee : 5.0,
			winnerQuote: 'N/A',
			providerId: PROVIDERS.UNASSIGNED,
			quotes: []
		},
		dispatchMode: DISPATCH_MODES.AUTO,
		status: STATUS.NEW,
		trackingHistory: [
			{
				timestamp: moment().unix(),
				status: STATUS.NEW
			}
		],
		vehicleType: payload.vehicleType
	};
	console.log(job);
	return job;
}

function incrementalBatchOrder(payload, settings, deliveryHours, jobReference, vehicleSpecs, ecommerceIds) {
	let job;
	let pickupStartTime;
	let dropoffEndTime;
	const batchInterval = settings.autoBatch.incremental.batchInterval;
	const waitTime = settings.autoBatch.incremental.waitTime;
	console.table({ batchInterval, waitTime });
	// check if the order is scheduled for SAME DAY
	if (moment(payload.packagePickupStartTime).date() === moment().date()) {
		const nextBatchTime = calculateNextHourlyBatch(moment(), deliveryHours, settings.autoBatch.incremental);
		// add on the wait time for the final pickup Start time
		pickupStartTime = nextBatchTime.add(Number(waitTime), 'minutes').format();
		dropoffEndTime = nextBatchTime.set('hour', 21).set('minute', 0).format();
	} else {
		const nextBatchTime = calculateNextHourlyBatch(
			moment(payload.packagePickupStartTime),
			deliveryHours,
			settings.autoBatch.incremental
		);
		// add on the wait time for the final pickup Start time
		pickupStartTime = nextBatchTime.add(Number(waitTime), 'minutes').format();
		dropoffEndTime = nextBatchTime.set('hour', 21).set('minute', 0).format();
	}
	console.table({ pickupStartTime, dropoffEndTime });
	job = {
		createdAt: moment().format(),
		driverInformation: {
			name: `NO DRIVER ASSIGNED`,
			phone: '',
			transport: ''
		},
		jobSpecification: {
			id: genDeliveryId(),
			jobReference: jobReference,
			orderNumber: orderId.generate(),
			...ecommerceIds,
			deliveryType: payload.packageDeliveryType,
			pickupStartTime,
			pickupEndTime: payload.packagePickupEndTime,
			pickupLocation: {
				fullAddress: payload.pickupAddress,
				streetAddress: String(payload.pickupAddressLine1).trim(),
				city: String(payload.pickupCity).trim(),
				postcode: String(payload.pickupPostcode).trim(),
				latitude: payload.pickupLatitude,
				longitude: payload.pickupLongitude,
				country: 'UK',
				phoneNumber: payload.pickupPhoneNumber,
				email: payload.pickupEmailAddress,
				firstName: payload.pickupFirstName,
				lastName: payload.pickupLastName,
				businessName: payload.pickupBusinessName,
				instructions: payload.pickupInstructions
			},
			deliveries: [
				{
					id: genDeliveryId(),
					orderReference: payload.drops[0]['reference'],
					description: payload.drops[0]['packageDescription'],
					dropoffEndTime,
					transport: vehicleSpecs.name,
					dropoffLocation: {
						fullAddress: payload.drops[0].dropoffAddress,
						streetAddress: payload.drops[0].dropoffAddressLine1 + payload.drops[0].dropoffAddressLine2,
						city: payload.drops[0].dropoffCity,
						postcode: payload.drops[0].dropoffPostcode,
						country: 'UK',
						latitude: payload.drops[0].dropoffLatitude,
						longitude: payload.drops[0].dropoffLongitude,
						phoneNumber: payload.drops[0].dropoffPhoneNumber,
						email: payload.drops[0].dropoffEmailAddress,
						firstName: payload.drops[0].dropoffFirstName,
						lastName: payload.drops[0].dropoffLastName,
						businessName: payload.drops[0].dropoffBusinessName ? payload.drops[0].dropoffBusinessName : '',
						instructions: payload.drops[0].dropoffInstructions ? payload.drops[0].dropoffInstructions : ''
					},
					trackingURL: '',
					status: STATUS.NEW
				}
			]
		},
		selectedConfiguration: {
			createdAt: moment().format(),
			deliveryFee: settings ? settings.driverDeliveryFee : 5.0,
			winnerQuote: 'N/A',
			providerId: PROVIDERS.UNASSIGNED,
			quotes: []
		},
		dispatchMode: DISPATCH_MODES.AUTO,
		status: STATUS.NEW,
		trackingHistory: [
			{
				timestamp: moment().unix(),
				status: STATUS.NEW
			}
		],
		vehicleType: payload.vehicleType
	};
	console.log(job);
	return job;
}

module.exports = {
	genJobReference,
	genOrderReference,
	genDeliveryId,
	createJobRequestPayload,
	getClientDetails,
	getVehicleSpecs,
	calculateJobDistance,
	checkAlternativeVehicles,
	checkJobExpired,
	chooseBestProvider,
	checkPickupHours,
	findAvailableDriver,
	getResultantQuotes,
	providerCreatesJob,
	providerCreateMultiJob,
	sendNewJobEmails,
	setNextDayDeliveryTime,
	cancelOrder,
	geocodeAddress,
	convertWeightToVehicleCode,
	sendWebhookUpdate,
	dailyBatchOrder,
	incrementalBatchOrder,
	finaliseJob
};
