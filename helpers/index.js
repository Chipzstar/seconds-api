const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const axios = require('axios');
const { pickupSchema, dropoffSchema } = require('../schemas/stuart/CreateJob');
const qs = require('qs');
const db = require('../models');
const crypto = require('crypto');
const moment = require('moment-timezone');
const { nanoid } = require('nanoid');
const { quoteSchema } = require('../schemas/quote');
const { SELECTION_STRATEGIES, PROVIDERS, VEHICLE_CODES } = require('../constants');
const { STRATEGIES } = require('../constants/streetStream');
const { ERROR_CODES: STUART_ERROR_CODES } = require('../constants/stuart');
const { ERROR_CODES: GOPHR_ERROR_CODES } = require('../constants/gophr');
moment.tz.setDefault('Europe/London');

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
		console.log(moment());
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

function genOrderNumber(number) {
	return number.toString().padStart(4, '0');
}

function getPackageType(vehicleCode, provider) {
	if (vehicleCode in VEHICLE_CODES) {
		switch (provider){
			case PROVIDERS.STUART:
				return VEHICLE_CODES[vehicleCode].stuartPackageType;
			case PROVIDERS.STREET_STREAM:
				return VEHICLE_CODES[vehicleCode].streetPackageType;
			default:
				return ""
		}
	} else {
		throw new Error(
			`Vehicle code ${vehicleCode} is not recognized. Please check our list of allowed vehicle codes`
		);
	}
}

async function getResultantQuotes(requestBody) {
	try {
		const QUOTES = [];
		// QUOTE AGGREGATION
		// send delivery request to integrated providers
		let stuartQuote = await getStuartQuote(genJobReference(), requestBody);
		QUOTES.push(stuartQuote);
		let gophrQuote = await getGophrQuote(requestBody);
		QUOTES.push(gophrQuote);
		let streetStreamQuote = await getStreetStreamQuote(requestBody);
		QUOTES.push(streetStreamQuote);
		return QUOTES;
	} catch (err) {
		console.error(err);
		throw err;
	}
}

async function providerCreatesJob(provider, ref, strategy, request) {
	switch (provider) {
		case PROVIDERS.STUART:
			console.log('Creating STUART Job');
			return await stuartJobRequest(ref, request);
		case PROVIDERS.GOPHR:
			console.log('Creating GOPHR Job');
			return await gophrJobRequest(ref, request);
		case PROVIDERS.STREET_STREAM:
			console.log('Creating STREET-STREAM Job');
			return await streetStreamJobRequest(ref, strategy, request);
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

async function getStuartQuote(reference, params) {
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
		vehicleType
	} = params;

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
					package_type: getPackageType(vehicleType, PROVIDERS.STUART),
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
	try {
		const config = { headers: { Authorization: `Bearer ${process.env.STUART_API_KEY}` } };
		const priceURL = `${process.env.STUART_ENV}/v2/jobs/pricing`;
		const etaURL = `${process.env.STUART_ENV}/v2/jobs/eta`;
		let { amount, currency } = (await axios.post(priceURL, payload, config)).data;
		let data = (await axios.post(etaURL, payload, config)).data;
		const quote = {
			...quoteSchema,
			id: `quote_${nanoid(15)}`,
			createdAt: moment().utc(true).format(),
			expireTime: moment().utc(true).add(5, 'minutes').format(),
			priceExVAT: amount,
			currency,
			dropoffEta: packagePickupStartTime
				? moment(packagePickupStartTime).utc(true).add(data.eta, 'seconds').format()
				: moment().utc(true).add(data.eta, 'seconds').format(),
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

async function getGophrQuote(params) {
	const {
		pickupFormattedAddress,
		dropoffFormattedAddress,
		packagePickupStartTime,
		packageDropoffStartTime,
		vehicleType,
	} = params;
	const { x: size_x, y: size_y, z: size_z, weight } = VEHICLE_CODES[vehicleType];
	const payload = qs.stringify({
		api_key: `${process.env.GOPHR_API_KEY}`,
		pickup_address1: pickupFormattedAddress['street'],
		...(pickupFormattedAddress.city && { pickup_city: pickupFormattedAddress.city}),
		pickup_postcode: pickupFormattedAddress.postcode,
		pickup_country_code: pickupFormattedAddress.countryCode,
		size_x,
		size_y,
		size_z,
		weight,
		...(packagePickupStartTime && { earliest_pickup_time: moment(packagePickupStartTime).toISOString() }),
		...(packageDropoffStartTime && { earliest_delivery_time: moment(packageDropoffStartTime).toISOString() }),
		delivery_address1: dropoffFormattedAddress['street'],
		...(dropoffFormattedAddress.city && { delivery_city: dropoffFormattedAddress.city}),
		delivery_postcode: dropoffFormattedAddress.postcode,
		delivery_country_code: dropoffFormattedAddress['countryCode'],
	});
	try {
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
				createdAt: moment().utc(true).format(),
				expireTime: moment().utc(true).add(5, 'minutes').format(),
				priceExVAT: price_net,
				currency: 'GBP',
				dropoffEta: moment(delivery_eta).utc(true).format(),
				providerId: PROVIDERS.GOPHR,
			};
			console.log('GOPHR QUOTE');
			console.log('----------------------------');
			console.log(quote);
			console.log('----------------------------');
			return quote;
		} else {
			console.log(response.error);
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

async function getStreetStreamQuote(params) {
	const { packagePickupStartTime, pickupFormattedAddress, dropoffFormattedAddress, vehicleType } = params;
	const packageType = getPackageType(vehicleType, PROVIDERS.STREET_STREAM);
	try {
		const config = {
			headers: { Authorization: `Bearer ${process.env.STREET_STREAM_API_KEY}` },
			params: {
				startPostcode: pickupFormattedAddress.postcode,
				endPostcode: dropoffFormattedAddress.postcode,
				packageTypeId: packageType,
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
			createdAt: moment().utc(true).format(),
			expireTime: moment().utc(true).add(5, 'minutes').format(),
			priceExVAT: data['estimatedCostVatExclusive'],
			currency: 'GBP',
			dropoffEta: packagePickupStartTime
				? moment(packagePickupStartTime).utc(true).add(data['estimatedTravelTimeInSeconds'], 'seconds').format()
				: null,
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

async function stuartJobRequest(refNumber, params) {
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
		vehicleType,
	} = params;
	const payload = {
		job: {
			pickup_at: moment(packagePickupStartTime, 'DD/MM/YYYY HH:mm:ss'),
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
					package_type: getPackageType(vehicleType, PROVIDERS.STUART),
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
					end_customer_time_window_start: packageDropoffStartTime,
					end_customer_time_window_end: packageDropoffEndTime,
				},
			],
		},
	};
	try {
		const URL = `${process.env.STUART_ENV}/v2/jobs`;
		const config = { headers: { Authorization: `Bearer ${process.env.STUART_API_KEY}` } };
		let data = (await axios.post(URL, payload, config)).data;
		console.log(data);
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

async function gophrJobRequest(refNumber, params) {
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
		packageDropoffStartTime,
		packageDropoffEndTime,
		packagePickupStartTime,
		packagePickupEndTime,
		vehicleType
	} = params;

	const { x: size_x, y: size_y, z: size_z, weight } = VEHICLE_CODES[vehicleType];
	const payload = qs.stringify({
		api_key: `${process.env.GOPHR_API_KEY}`,
		external_id: `${refNumber}`,
		pickup_person_name: `${pickupFirstName} + ' ' + ${pickupLastName}`,
		pickup_mobile_number: `${pickupPhoneNumber}`,
		pickup_company_name: `${pickupBusinessName}`,
		pickup_email: pickupEmailAddress,
		delivery_person_name: `${dropoffFirstName} + ' ' + ${dropoffLastName}`,
		delivery_mobile_number: `${dropoffPhoneNumber}`,
		delivery_company_name: `${dropoffBusinessName}`,
		delivery_email: dropoffEmailAddress,
		pickup_address1: pickupFormattedAddress['street'],
		...(pickupFormattedAddress.city && { pickup_city: pickupFormattedAddress.city}),
		pickup_postcode: pickupFormattedAddress.postcode,
		pickup_country_code: pickupFormattedAddress.countryCode,
		pickup_tips_how_to_find: pickupInstructions,
		size_x,
		size_y,
		size_z,
		weight,
		job_priority: 3,
		earliest_pickup_time: packagePickupStartTime,
		pickup_deadline: packagePickupEndTime,
		earliest_delivery_time: packageDropoffStartTime,
		dropoff_deadline: packageDropoffEndTime,
		delivery_address1: dropoffFormattedAddress['street'],
		...(dropoffFormattedAddress.city && { delivery_city: dropoffFormattedAddress.city}),
		delivery_postcode: dropoffFormattedAddress.postcode,
		delivery_country_code: dropoffFormattedAddress.countryCode,
		delivery_tips_how_to_find: dropoffInstructions,
		callback_url: process.env.GOPHR_CALLBACK_URL,
	});

	try {
		const config = { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } };
		const createJobURL = `${process.env.GOPHR_ENV}/v1/commercial-api/create-confirm-job`;
		const { data } = (await axios.post(createJobURL, payload, config)).data;
		console.log(data);
		const { job_id, public_tracker_url, pickup_eta, delivery_eta, price_gross } = data;
		return {
			id: job_id,
			trackingURL: public_tracker_url,
			deliveryFee: price_gross,
			pickupAt: pickup_eta,
			dropoffAt: delivery_eta,
		};
	} catch (err) {
		throw err;
	}
}

async function streetStreamJobRequest(refNumber, strategy, params) {
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
		vehicleType,
	} = params;

	const payload = {
		offerAcceptanceStrategy:
			strategy === SELECTION_STRATEGIES.RATING
				? STRATEGIES.AUTO_HIGHEST_RATED_COURIER
				: STRATEGIES.AUTO_CLOSEST_COURIER_TO_ME,
		packageTypeId: getPackageType(vehicleType, PROVIDERS.STREET_STREAM),
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
			pickUpFrom: packagePickupStartTime
				? moment(packagePickupStartTime).utc(true).format()
				: moment().utc(true).format(),
			pickUpTo: packagePickupEndTime
				? moment(packagePickupEndTime).utc(true).format()
				: moment().utc(true).add(5, 'minutes').format(),
		},
		dropOff: {
			contactNumber: dropoffPhoneNumber,
			contactName: `${dropoffFirstName} ${dropoffLastName}`,
			addressOne: dropoffFormattedAddress.street,
			city: dropoffFormattedAddress.city,
			postcode: dropoffFormattedAddress.postcode,
			dropOffFrom: packageDropoffStartTime
				? moment(packageDropoffStartTime).utc(true).format()
				: moment().utc(true).format(),
			dropOffTo: packageDropoffEndTime
				? moment(packageDropoffEndTime).utc().format()
				: moment().utc(true).add(5, 'minutes').format(),
			clientTag: refNumber,
			deliveryNotes: dropoffInstructions,
		},
	};
	try {
		const config = { headers: { Authorization: `Bearer ${process.env.STREET_STREAM_API_KEY}` } };
		const createJobURL = `${process.env.STREET_STREAM_ENV}/api/job/pointtopoint`;
		const data = (await axios.post(createJobURL, payload, config)).data;
		console.log(data);
		return {
			id: data.id,
			trackingURL: null,
			deliveryFee: data['jobCharge']['totalPayableWithVat'],
			pickupAt: moment(packagePickupStartTime).toISOString(),
			dropoffAt: moment(packagePickupStartTime).add(data['estimatedRouteTimeSeconds'], 'seconds').toISOString(),
		};
	} catch (err) {
		throw err;
	}
}

/*async function confirmCharge(amount, customerId, paymentIntentId) {
	try {
		console.log('*********************************');
		console.log('AMOUNT:', amount);
		console.log('CUSTOMER_ID:', customerId);
		console.log('PAYMENT_INTENT_ID:', paymentIntentId);
		console.log('*********************************');
		if (customerId) {
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
}*/

async function handleActiveSubscription(subscription) {
	try {
		console.log(subscription);
		const { id, customer, status } = subscription;
		if (status === 'active') {
			const user = await db.User.findOneAndUpdate(
				{ stripeCustomerId: customer },
				{ subscriptionId: id },
				{ new: true }
			);
			console.log('------------------------------------');
			console.log('updated user:', user);
			console.log('------------------------------------');
			return 'Subscription is active';
		} else {
			throw new Error('Subscription status is not active');
		}
	} catch (err) {
		console.error(err);
		throw new Error('No user found with a matching stripe customer ID!');
	}
}

async function handleCanceledSubscription(subscription) {
	try {
		console.log(subscription);
		const { customer, status } = subscription;
		if (status === 'canceled') {
			const user = await db.User.findOneAndUpdate(
				{ stripeCustomerId: customer },
				{ subscriptionId: '' },
				{ new: true }
			);
			console.log('------------------------------------');
			console.log('updated user:', user);
			console.log('------------------------------------');
			return 'Subscription is canceled';
		} else {
			throw new Error('Subscription status is not canceled');
		}
	} catch (err) {
		console.error(err);
		throw new Error('No user found with a matching stripe customer ID!');
	}
}

module.exports = {
	genJobReference,
	getClientDetails,
	chooseBestProvider,
	genOrderNumber,
	getResultantQuotes,
	providerCreatesJob,
	handleActiveSubscription,
	handleCanceledSubscription,
};
