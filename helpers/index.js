const axios = require('axios');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { Client } = require('@googlemaps/google-maps-services-js');
const { pickupSchema, dropoffSchema } = require('../schemas/stuart/CreateJob');
const qs = require('qs');
const db = require('../models');
const crypto = require('crypto');
const moment = require('moment-timezone');
const { nanoid } = require('nanoid');
const { quoteSchema } = require('../schemas/quote');
const { SELECTION_STRATEGIES, PROVIDERS, VEHICLE_CODES_MAP, DELIVERY_TYPES, VEHICLE_CODES } = require('../constants');
const { STRATEGIES } = require('../constants/streetStream');
const { ERROR_CODES: STUART_ERROR_CODES } = require('../constants/stuart');
const { ERROR_CODES: GOPHR_ERROR_CODES } = require('../constants/gophr');

const client = new Client();

function genAssignmentCode() {
	const rand = crypto.randomBytes(7);
	let chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'.repeat(2);

	let str = 'A';

	for (let i = 0; i < rand.length; i++) {
		let index = rand[i] % chars.length;
		str += chars[index];
	}
	console.log('Generated Assignment Code', str);
	return str;
}

function genJobReference() {
	const rand = crypto.randomBytes(16);
	let chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'.repeat(2);

	let str = '';

	for (let i = 0; i < rand.length; i++) {
		let index = rand[i] % chars.length;
		str += chars[index];
	}
	console.log('Generated Reference:', str);
	return str;
}

function chooseBestProvider(strategy, quotes) {
	let bestPriceIndex;
	let bestEtaIndex;
	let bestPrice = Infinity;
	let bestEta = Infinity;
	quotes.forEach(({ priceExVAT, dropoffEta, providerId }, index) => {
		console.log('------------------------');
		console.log(providerId);
		console.log('------------------------');
		if (priceExVAT < bestPrice) {
			bestPrice = priceExVAT;
			bestPriceIndex = index;
		}
		console.log(dropoffEta);
		console.log(moment(dropoffEta));
		let duration = moment.duration(moment(dropoffEta).diff(moment())).asSeconds();
		console.log('DURATION:', duration);
		if (duration < bestEta) {
			bestEta = duration;
			bestEtaIndex = index;
		}
	});
	if (strategy === SELECTION_STRATEGIES.PRICE) {
		console.log('BEST:', quotes[bestPriceIndex]);
		return quotes[bestPriceIndex];
	} else {
		console.log('BEST:', quotes[bestEtaIndex]);
		return quotes[bestEtaIndex];
	}
}

async function calculateJobDistance(origin, destination, mode) {
	console.log('PICKUP:', origin);
	console.log('DROPOFF:', destination);
	try {
		const distanceMatrix = (
			await client.distancematrix({
				params: {
					origins: [origin],
					destinations: [destination],
					key: process.env.GOOGLE_MAPS_API_KEY,
					units: 'imperial',
					mode,
				},
				responseType: 'json',
			})
		).data;
		console.log(distanceMatrix.rows[0].elements[0])
		let distance = Number(distanceMatrix.rows[0].elements[0].distance.text.split(' ')[0]);
		console.log('================================================');
		console.log('JOB DISTANCE');
		console.log(distance + ' miles');
		console.log('================================================');
		return distance;
	} catch (err) {
		throw err;
	}
}

function getVehicleSpecs(vehicleCode) {
	if (VEHICLE_CODES.includes(vehicleCode)) {
		return VEHICLE_CODES_MAP[vehicleCode];
	} else {
		throw new Error(
			`Vehicle code ${vehicleCode} is not recognized. Please check our list of allowed vehicle codes`
		);
	}
}

async function checkAlternativeVehicles(pickup, dropoff, jobDistance, travelMode) {
	try {
		for (let [code, specs] of Object.entries(VEHICLE_CODES_MAP)) {
			// if travelMode of the transport type changes, calculate the job distance again using the new mode
			if (travelMode !== specs.travelMode)
				jobDistance = await calculateJobDistance(pickup, dropoff, specs.travelMode);
			if (jobDistance <= specs.maxDistance) {
				console.log('Changing Vehicle Type:', specs.name);
				return specs;
			}
		}
		return Promise.reject({
			message: 'Job distance exceeds the maximum limit. The maximum distance for delivery jobs is 12 miles',
			code: 400,
		});
	} catch (err) {
		console.log(err);
	}
}

function checkDeliveryHours(createdAt, deliveryHours) {
	console.log('===================================================================');
	const today = String(moment().day());
	console.log('Current Day:', today);
	// get open / close times for the current day of the week
	const open = moment({ h: deliveryHours[today].open['h'], m: deliveryHours[today].open['m'] });
	const close = moment({ h: deliveryHours[today].close['h'], m: deliveryHours[today].close['m'] });
	// check time of creation is within the delivery hours
	let timeFromOpen = moment.duration(moment(createdAt).diff(open)).asHours();
	let timeFromClose = moment.duration(moment(createdAt).diff(close)).asHours();
	console.log('DURATION:', { open: open.format('HH:mm'), timeFromOpen });
	console.log('DURATION:', { close: close.format('HH:mm'), timeFromClose });
	console.log('===================================================================');
	return timeFromClose <= -0.5 && timeFromOpen >= 0;
}

function setNextDayDeliveryTime(deliveryHours) {
	console.log('===================================================================');
	const max = 6;
	let interval = 0;
	let nextDay = moment().day();
	console.log('Current Day:', nextDay);
	// check that the store has at least one day in the week that allows delivery
	const isValid = Object.entries(JSON.parse(JSON.stringify(deliveryHours))).some(
		([key, value]) => value.canDeliver === true
	);
	// check if the datetime is not in the past & if store allows delivery on that day, if not check another day
	if (isValid) {
		// if a day does not allow deliveries OR if the time of the order request is AHEAD of the current day's opening time (only when nextDay = "Today")
		// iterate over to the next day
		while (
			!deliveryHours[nextDay].canDeliver ||
			moment().diff(moment(deliveryHours[nextDay].open).add(interval, 'days'), 'minutes') > 0
		) {
			nextDay === max ? (nextDay = 0) : (nextDay = nextDay + 1);
			interval = interval + 1;
		}
		// return the pickup time for the next day delivery
		const open = { h: deliveryHours[nextDay].open['h'], m: deliveryHours[nextDay].open['m'] };
		console.log(open);
		console.log('===================================================================');
		return moment(open).add(interval, 'days').format();
	} else {
		throw new Error('Store has no delivery hours available!');
	}
}

async function authStreetStream() {
	const authURL = `${process.env.STREET_STREAM_ENV}/api/tokens`;
	const payload = {
		email: 'secondsdelivery@gmail.com',
		authType: 'CUSTOMER',
		password: process.env.STREET_STREAM_PASSWORD,
	};
	let res = (await axios.post(authURL, payload)).headers;
	return res.authorization.split(' ')[1];
}

async function getResultantQuotes(requestBody, vehicleSpecs) {
	try {
		const QUOTES = [];
		// QUOTE AGGREGATION
		// send delivery request to integrated providers
		let stuartQuote = await getStuartQuote(genJobReference(), requestBody, vehicleSpecs);
		QUOTES.push(stuartQuote);
		let gophrQuote = await getGophrQuote(requestBody, vehicleSpecs);
		QUOTES.push(gophrQuote);
		let streetStreamQuote = await getStreetStreamQuote(requestBody, vehicleSpecs);
		QUOTES.push(streetStreamQuote);
		let ecoFleetQuote = {
			...quoteSchema,
			id: `quote_${nanoid(15)}`,
			createdAt: moment().format(),
			expireTime: moment().add(5, 'minutes').format(),
			dropoffEta: null,
			priceExVAT: Infinity,
			currency: 'GBP',
			providerId: 'ecofleet',
		};
		QUOTES.push(ecoFleetQuote);
		return QUOTES;
	} catch (err) {
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
			return await ecofleetJobRequest(ref, request);
		// default case if no valid providerId was chosen
		default:
			console.log('Creating a STUART Job');
			return await stuartJobRequest(ref, request);
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
		dropoffAddress,
		dropoffPhoneNumber,
		dropoffEmailAddress,
		dropoffBusinessName,
		dropoffFirstName,
		dropoffLastName,
		dropoffInstructions,
		packageDropoffStartTime,
		packageDropoffEndTime,
		packagePickupStartTime,
	} = params;
	try {
		const payload = {
			job: {
				...(packagePickupStartTime && { pickup_at: moment(packagePickupStartTime).toISOString() }),
				assignment_code: genAssignmentCode(),
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
							company: pickupBusinessName,
						},
					},
				],
				dropoffs: [
					{
						...dropoffSchema,
						package_type: vehicleSpecs.stuartPackageType,
						client_reference: reference,
						address: dropoffAddress,
						comment: dropoffInstructions,
						contact: {
							firstname: dropoffFirstName,
							lastname: dropoffLastName,
							phone: dropoffPhoneNumber,
							email: dropoffEmailAddress,
							company: dropoffBusinessName,
						},
						...(packageDropoffStartTime && { end_customer_time_window_start: packageDropoffStartTime }),
						...(packageDropoffEndTime && { end_customer_time_window_end: packageDropoffEndTime }),
					},
				],
			},
		};
		console.log('PAYLOAD');
		console.log('--------------------------');
		console.log({ ...payload.job });
		console.log('--------------------------');
		const config = { headers: { Authorization: `Bearer ${process.env.STUART_API_KEY}` } };
		const priceURL = `${process.env.STUART_ENV}/v2/jobs/pricing`;
		const etaURL = `${process.env.STUART_ENV}/v2/jobs/eta`;
		let { amount, currency } = (await axios.post(priceURL, payload, config)).data;
		let data = (await axios.post(etaURL, payload, config)).data;
		const quote = {
			...quoteSchema,
			id: `quote_${nanoid(15)}`,
			createdAt: moment().format(),
			expireTime: moment().add(5, 'minutes').format(),
			priceExVAT: amount,
			currency,
			dropoffEta: packagePickupStartTime
				? moment(packagePickupStartTime).add(data.eta, 'seconds').format()
				: moment().add(data.eta, 'seconds').format(),
			providerId: PROVIDERS.STUART,
		};
		console.log('STUART QUOTE');
		console.log('----------------------------');
		console.log(quote);
		console.log('----------------------------');
		return quote;
	} catch (err) {
		console.error(err);
		if (err.response.status === STUART_ERROR_CODES.UNPROCESSABLE_ENTITY) {
			if (err.response.data.error === STUART_ERROR_CODES.RECORD_INVALID) {
				if (err.response.data.data === 'deliveries') {
					throw { code: err.response.status, message: err.response.data.data['deliveries'][1] };
				} else if (err.response.data.data === 'job.pickup_at') {
					throw { code: err.response.status, message: err.response.data.data['job.pickup_at'][0] };
				} else if (err.response.data.data === 'pickup_at') {
					throw { code: err.response.status, message: err.response.data.data['pickup_at'][0] };
				}
			} else {
				throw { code: err.response.status, ...err.response.data };
			}
		} else if (err.response.status === STUART_ERROR_CODES.INVALID_GRANT) {
			throw { code: err.response.status, ...err.response.data };
		} else {
			throw err;
		}
	}
}

async function getGophrQuote(params, vehicleSpecs) {
	const { pickupFormattedAddress, dropoffFormattedAddress, packagePickupStartTime, packageDropoffStartTime } = params;
	// get gophr vehicle/package specs
	try {
		const { x: size_x, y: size_y, z: size_z, weight, gophrVehicleType } = vehicleSpecs;
		const payload = qs.stringify({
			api_key: `${process.env.GOPHR_API_KEY}`,
			pickup_address1: pickupFormattedAddress['street'],
			...(pickupFormattedAddress.city && { pickup_city: pickupFormattedAddress.city }),
			pickup_postcode: pickupFormattedAddress.postcode,
			pickup_country_code: pickupFormattedAddress['countryCode'],
			size_x,
			size_y,
			size_z,
			weight,
			vehicle_type: gophrVehicleType,
			...(packagePickupStartTime && { earliest_pickup_time: moment(packagePickupStartTime).toISOString(true) }),
			...(packageDropoffStartTime && {
				earliest_delivery_time: moment(packageDropoffStartTime).toISOString(true),
			}),
			delivery_address1: dropoffFormattedAddress['street'],
			...(dropoffFormattedAddress.city && { delivery_city: dropoffFormattedAddress.city }),
			delivery_postcode: dropoffFormattedAddress.postcode,
			delivery_country_code: dropoffFormattedAddress['countryCode'],
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
				expireTime: moment().add(5, 'minutes').format(),
				priceExVAT: price_net,
				currency: 'GBP',
				dropoffEta: moment(delivery_eta).format(),
				providerId: PROVIDERS.GOPHR,
			};
			console.log('GOPHR QUOTE');
			console.log('----------------------------');
			console.log(quote);
			console.log('----------------------------');
			return quote;
		} else {
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
		console.error(err);
		throw err;
	}
}

async function getStreetStreamQuote(params, vehicleSpecs) {
	const { pickupFormattedAddress, dropoffFormattedAddress } = params;
	try {
		const token = await authStreetStream();
		const config = {
			headers: { Authorization: `Bearer ${token}` },
			params: {
				startPostcode: pickupFormattedAddress.postcode,
				endPostcode: dropoffFormattedAddress.postcode,
				packageTypeId: vehicleSpecs.streetPackageType,
			},
		};
		const quoteURL = `${process.env.STREET_STREAM_ENV}/api/estimate`;
		let data = (await axios.get(quoteURL, config)).data;
		console.log('RESPONSE');
		console.log('****************************');
		console.log(data);
		console.log('****************************');
		const quote = {
			...quoteSchema,
			id: `quote_${nanoid(15)}`,
			createdAt: moment().format(),
			expireTime: moment().add(5, 'minutes').format(),
			priceExVAT: data['estimatedCostVatExclusive'],
			currency: 'GBP',
			dropoffEta: null,
			providerId: PROVIDERS.STREET_STREAM,
		};
		console.log('STREET STREAM QUOTE');
		console.log('----------------------------');
		console.log(quote);
		console.log('----------------------------');
		return quote;
	} catch (err) {
		throw err;
	}
}

async function getAddisonLeeQuote(params, vehicleSpecs) {
	const { pickupFormattedAddress, dropoffFormattedAddress, pickupInstructions, dropoffInstructions } = params;
	try {
		const config = { headers: { Authorization: process.env.ADDISON_LEE_API_KEY } };
		const payload = {
			services: [
				{
					code: 'standard_car',
				},
				{
					code: 'large_car',
				},
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
					country: pickupFormattedAddress.countryCode,
				},
				{
					street_address: dropoffFormattedAddress.street,
					source: 'Address',
					lat: 51.498233,
					long: -0.143448,
					notes: dropoffInstructions,
					town: dropoffFormattedAddress.city,
					postcode: dropoffFormattedAddress.postcode,
					country: dropoffFormattedAddress.countryCode,
				},
			],
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
			providerId: PROVIDERS.ADDISON_LEE,
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

async function stuartJobRequest(refNumber, params, vehicleSpecs) {
	const {
		pickupAddress,
		pickupPhoneNumber,
		pickupEmailAddress,
		pickupBusinessName,
		pickupFirstName,
		pickupLastName,
		pickupInstructions,
		dropoffAddress,
		dropoffPhoneNumber,
		dropoffEmailAddress,
		dropoffBusinessName,
		dropoffFirstName,
		dropoffLastName,
		dropoffInstructions,
		packageDropoffStartTime,
		packageDropoffEndTime,
		packagePickupStartTime,
		packageDescription,
	} = params;
	try {
		const payload = {
			job: {
				...(packagePickupStartTime && { pickup_at: moment(packagePickupStartTime).format() }),
				assignment_code: genAssignmentCode(),
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
							company: pickupBusinessName,
						},
					},
				],
				dropoffs: [
					{
						...dropoffSchema,
						package_type: vehicleSpecs.stuartPackageType,
						package_description: packageDescription,
						client_reference: refNumber,
						address: dropoffAddress,
						comment: dropoffInstructions,
						contact: {
							firstname: dropoffFirstName,
							lastname: dropoffLastName,
							phone: dropoffPhoneNumber,
							email: dropoffEmailAddress,
							company: dropoffBusinessName,
						},
						...(packageDropoffStartTime && { end_customer_time_window_start: packageDropoffStartTime }),
						...(packageDropoffEndTime && { end_customer_time_window_end: packageDropoffEndTime }),
					},
				],
			},
		};
		const URL = `${process.env.STUART_ENV}/v2/jobs`;
		const config = { headers: { Authorization: `Bearer ${process.env.STUART_API_KEY}` } };
		let data = (await axios.post(URL, payload, config)).data;
		console.log('----------------------------');
		console.log(data);
		console.log('----------------------------');
		return {
			id: String(data.id),
			deliveryFee: data['pricing']['price_tax_included'],
			trackingURL: data.deliveries[0].tracking_url,
			pickupAt: data['pickup_at'],
			dropoffAt: data['dropoff_at'],
		};
	} catch (err) {
		throw err;
	}
}

async function gophrJobRequest(refNumber, params, vehicleSpecs) {
	const {
		pickupFormattedAddress,
		pickupPhoneNumber,
		pickupEmailAddress,
		pickupBusinessName,
		pickupFirstName,
		pickupLastName,
		pickupInstructions,
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
	} = params;

	try {
		const { x: size_x, y: size_y, z: size_z, weight, gophrVehicleType } = vehicleSpecs;
		const payload = qs.stringify({
			api_key: `${process.env.GOPHR_API_KEY}`,
			external_id: refNumber,
			reference_number: refNumber,
			pickup_person_name: `${pickupFirstName} ${pickupLastName}`,
			pickup_mobile_number: `${pickupPhoneNumber}`,
			pickup_company_name: `${pickupBusinessName}`,
			pickup_email: pickupEmailAddress,
			delivery_person_name: `${dropoffFirstName} ${dropoffLastName}`,
			delivery_mobile_number: `${dropoffPhoneNumber}`,
			delivery_company_name: `${dropoffBusinessName}`,
			delivery_email: `${dropoffEmailAddress}`,
			pickup_address1: `${pickupFormattedAddress['street']}`,
			...(pickupFormattedAddress.city && { pickup_city: `${pickupFormattedAddress.city}` }),
			pickup_postcode: `${pickupFormattedAddress.postcode}`,
			pickup_country_code: `${pickupFormattedAddress['countryCode']}`,
			pickup_tips_how_to_find: `${pickupInstructions}`,
			size_x,
			size_y,
			size_z,
			weight,
			vehicle_type: gophrVehicleType,
			...(packagePickupStartTime && { earliest_pickup_time: moment(packagePickupStartTime).toISOString(true) }),
			...(packageDropoffStartTime && {
				earliest_delivery_time: moment(packageDropoffStartTime).toISOString(true),
			}),
			...(packagePickupEndTime && { pickup_deadline: moment(packagePickupEndTime).toISOString(true) }),
			...(packageDropoffEndTime && { dropoff_deadline: moment(packageDropoffEndTime).toISOString(true) }),
			delivery_address1: `${dropoffFormattedAddress['street']}`,
			...(dropoffFormattedAddress.city && { delivery_city: `${dropoffFormattedAddress.city}` }),
			delivery_postcode: `${dropoffFormattedAddress.postcode}`,
			delivery_country_code: `${dropoffFormattedAddress['countryCode']}`,
			delivery_tips_how_to_find: `${dropoffInstructions}`,
		});
		console.log(payload)
		const config = { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } };
		const createJobURL = `${process.env.GOPHR_ENV}/v1/commercial-api/create-confirm-job`;
		const response = (await axios.post(createJobURL, payload, config)).data;
		if (response.success) {
			console.log('RESPONSE');
			console.log('****************************');
			console.log(response.data);
			console.log('****************************');
			const { job_id, public_tracker_url, pickup_eta, delivery_eta, price_gross } = response.data;
			return {
				id: job_id,
				trackingURL: public_tracker_url,
				deliveryFee: price_gross,
				pickupAt: pickup_eta,
				dropoffAt: delivery_eta,
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

async function streetStreamJobRequest(refNumber, strategy, params, vehicleSpecs) {
	const {
		pickupFormattedAddress,
		pickupPhoneNumber,
		pickupFirstName,
		pickupLastName,
		pickupInstructions,
		dropoffFormattedAddress,
		dropoffPhoneNumber,
		dropoffFirstName,
		dropoffLastName,
		dropoffInstructions,
		packageDropoffStartTime,
		packageDropoffEndTime,
		packagePickupStartTime,
		packagePickupEndTime,
	} = params;
	try {
		const payload = {
			offerAcceptanceStrategy:
				strategy === SELECTION_STRATEGIES.RATING
					? STRATEGIES.AUTO_HIGHEST_RATED_COURIER
					: STRATEGIES.AUTO_CLOSEST_COURIER_TO_ME,
			packageTypeId: vehicleSpecs.streetPackageType,
			jobLabel: refNumber,
			insuranceCover: 'PERSONAL',
			submitForQuotesImmediately: true,
			pickUp: {
				contactNumber: pickupPhoneNumber,
				contactName: `${pickupFirstName} ${pickupLastName}`,
				addressOne: pickupFormattedAddress.street,
				city: pickupFormattedAddress.city,
				postcode: pickupFormattedAddress.postcode,
				pickUpNotes: pickupInstructions,
				pickUpFrom: packagePickupStartTime ? moment(packagePickupStartTime).format() : moment().format(),
				pickUpTo: packagePickupEndTime
					? moment(packagePickupEndTime).format()
					: moment().add(5, 'minutes').format(),
			},
			dropOff: {
				contactNumber: dropoffPhoneNumber,
				contactName: `${dropoffFirstName} ${dropoffLastName}`,
				addressOne: dropoffFormattedAddress.street,
				city: dropoffFormattedAddress.city,
				postcode: dropoffFormattedAddress.postcode,
				dropOffFrom: packageDropoffStartTime ? moment(packageDropoffStartTime).format() : moment().format(),
				dropOffTo: packageDropoffEndTime
					? moment(packageDropoffEndTime).format()
					: moment().add(5, 'minutes').format(),
				clientTag: refNumber,
				deliveryNotes: dropoffInstructions,
			},
		};
		const token = await authStreetStream();
		const config = { headers: { Authorization: `Bearer ${token}` } };
		const createJobURL = `${process.env.STREET_STREAM_ENV}/api/job/pointtopoint`;
		const data = (await axios.post(createJobURL, payload, config)).data;
		console.log(data);
		return {
			id: data.id,
			trackingURL: null,
			deliveryFee: data['jobCharge']['totalPayableWithVat'],
			pickupAt: packagePickupStartTime ? moment(packagePickupStartTime) : moment().add(25, 'minutes'),
			dropoffAt: packageDropoffStartTime
				? moment(packagePickupStartTime).add(data['estimatedRouteTimeSeconds'], 'seconds').format()
				: moment().add(25, 'minutes').add(data['estimatedRouteTimeSeconds'], 'seconds').format(),
		};
	} catch (err) {
		throw err;
	}
}

async function ecofleetJobRequest(refNumber, params) {
	const {
		pickupFormattedAddress,
		pickupPhoneNumber,
		pickupEmailAddress,
		pickupBusinessName,
		pickupFirstName,
		pickupLastName,
		pickupInstructions,
		dropoffFormattedAddress,
		dropoffPhoneNumber,
		dropoffEmailAddress,
		dropoffBusinessName,
		dropoffFirstName,
		dropoffLastName,
		dropoffInstructions,
		packageDeliveryType,
		packageDropoffStartTime,
		packagePickupStartTime,
		packageDescription,
		vehicleType,
	} = params;

	const payload = {
		pickup: {
			name: `${pickupFirstName} ${pickupLastName}`,
			company_name: pickupBusinessName,
			address_line1: pickupFormattedAddress.street,
			city: pickupFormattedAddress.city,
			postal: pickupFormattedAddress.postcode,
			country: 'England',
			phone: pickupPhoneNumber,
			email: pickupEmailAddress,
			comment: pickupInstructions,
		},
		drops: [
			{
				name: `${dropoffFirstName} ${dropoffLastName}`,
				company_name: dropoffBusinessName,
				address_line1: dropoffFormattedAddress.street,
				city: dropoffFormattedAddress.city,
				postal: dropoffFormattedAddress.postcode,
				country: 'England',
				phone: dropoffPhoneNumber,
				email: dropoffEmailAddress,
				comment: dropoffInstructions,
			},
		],
		parcel: {
			weight: VEHICLE_CODES_MAP[vehicleType].weight,
			type: packageDescription ? packageDescription : '[]',
		},
		schedule: {
			type: DELIVERY_TYPES[packageDeliveryType].ecofleet,
			...(packagePickupStartTime && { pickupWindow: moment(packagePickupStartTime).unix() }),
			...(packageDropoffStartTime && { dropoffWindow: moment(packageDropoffStartTime).unix() }),
		},
	};
	console.log(payload);
	try {
		const config = { headers: { Authorization: `Bearer ${process.env.ECOFLEET_API_KEY}` } };
		const createJobURL = `${process.env.ECOFLEET_ENV}/api/v1/order`;
		const data = (await axios.post(createJobURL, payload, config)).data;
		console.log(data);
		return {
			id: data.id,
			trackingURL: null,
			deliveryFee: data['rate_card']['minimum_cost'],
			pickupAt: packagePickupStartTime ? moment(packagePickupStartTime).format() : undefined,
			dropoffAt: packageDropoffStartTime ? moment(packageDropoffStartTime).format() : undefined,
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
				email: 'john.doe@example.com',
			},
			passengers: [
				{
					name: 'Jane Doe',
					mobile: '07262555555',
					email: 'jane.doe@example.com',
				},
				{
					name: 'Jane Smith',
					mobile: '07123456789',
					email: 'jane.smith@example.com',
				},
			],
			information: [
				{
					type: 'Notes',
					value: 'Special Instruction Notes',
				},
				{
					type: 'Description',
					value: 'Addison Lee to Collect John Doe',
				},
			],
			partner_reference: {
				booking: {
					id: '9d8760a1-84cb-42d5-8887-f9574e75ede7',
					number: '345677',
				},
			},
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
			providerId: PROVIDERS.ADDISON_LEE,
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

async function confirmCharge(amount, customerId, paymentIntentId) {
	try {
		console.log('*********************************');
		console.log('AMOUNT:', amount);
		console.log('CUSTOMER_ID:', customerId);
		console.log('PAYMENT_INTENT_ID:', paymentIntentId);
		console.log('*********************************');
		if (customerId && paymentIntentId) {
			const paymentIntent = await stripe.paymentIntents.confirm(paymentIntentId, {
				setup_future_usage: 'off_session',
			});
			console.log('----------------------------------------------');
			console.log('PAYMENT CONFIRMED!!!!');
			console.log(paymentIntent);
			console.log('----------------------------------------------');
			return 'Payment Confirmed!';
		}
	} catch (e) {
		console.error(e);
		throw e;
	}
}

module.exports = {
	genJobReference,
	getClientDetails,
	getVehicleSpecs,
	calculateJobDistance,
	checkAlternativeVehicles,
	chooseBestProvider,
	checkDeliveryHours,
	getResultantQuotes,
	providerCreatesJob,
	confirmCharge,
	setNextDayDeliveryTime
};
