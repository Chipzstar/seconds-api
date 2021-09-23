const axios = require("axios");
const { pickupSchema, dropoffSchema } = require("../schemas/stuart/CreateJob");
const qs = require("qs");
const db = require("../models");
const crypto = require("crypto");
const moment = require("moment-timezone");
const {nanoid} = require("nanoid");
const {quoteSchema} = require("../schemas/quote");
const {SELECTION_STRATEGIES, ERROR_CODES, PROVIDERS} = require("../constants");

function genAssignmentCode() {
	const rand = crypto.randomBytes(7);
	let chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789".repeat(2)

	let str = 'A';

	for (let i = 0; i < rand.length; i++) {
		let index = rand[i] % chars.length;
		str += chars[index];
	}
	console.log("Generated Assignment Code", str);
	return str;
}

function genJobReference() {
	const rand = crypto.randomBytes(16);
	let chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789".repeat(2)

	let str = '';

	for (let i = 0; i < rand.length; i++) {
		let index = rand[i] % chars.length;
		str += chars[index];
	}
	console.log("Generated Reference:", str);
	return str;
}

/*function calculateFare(distance) {
	let fare = 0.0
	if (distance > 1) {
		fare = fare + 3.5
	}
	if (distance > 10) {
		fare = fare + 1
	}
	fare = fare + (distance * 1.50) + 0.25
	return fare.toFixed(2)
}*/

function chooseBestProvider(strategy, quotes) {
	let bestPriceIndex;
	let bestEtaIndex;
	let bestPrice = Infinity
	let bestEta = Infinity
	quotes.forEach(({price, dropoffEta, providerId}, index) => {
		if (price < bestPrice) {
			bestPrice = price
			bestPriceIndex = index
		}
		let duration = moment.duration(moment(dropoffEta).diff(moment())).asSeconds()
		if (duration < bestEta) {
			bestEta = duration
			bestEtaIndex = index
		}
	})
	if (strategy === SELECTION_STRATEGIES.PRICE) {
		console.log("BEST:", quotes[bestPriceIndex])
		return quotes[bestPriceIndex]
	} else {
		console.log("BEST:", quotes[bestEtaIndex])
		return quotes[bestEtaIndex]
	}
}

function genOrderNumber(number) {
	return number.toString().padStart(4, "0")
}

async function providerCreatesJob(job, ref, body) {
	switch (job) {
		case PROVIDERS.STUART:
			console.log("STUAAART")
			return await stuartJobRequest(ref, body);
		case PROVIDERS.GOPHR:
			console.log('GOPHRRRR')
			return await gophrJobRequest(ref, body);
		//default case for testing
		default:
			console.log('GOPHRRRR')
			return await stuartJobRequest(ref, body);
	}
}

async function getClientSelectionStrategy(apiKey) {
	try {
		const foundClient = await db.User.findOne({"apiKey": apiKey}, {});
		//look up selection strategy
		return foundClient["selectionStrategy"];
	} catch (err) {
		console.error(err)
		throw err
	}
}

async function getResultantQuotes(requestBody, referenceNumber) {
	try {
		const QUOTES = []
		// QUOTE AGGREGATION
		// send delivery request to integrated providers
		let stuartQuote = await getStuartQuote(referenceNumber, requestBody)
		let gophrQuote = await getGophrQuote(referenceNumber, requestBody)
		QUOTES.push(stuartQuote)
		QUOTES.push(gophrQuote)
		return QUOTES
	} catch (err) {
		console.error(err)
		throw err
	}
}

async function getGophrQuote(refNumber, params) {
	const {
		pickupFormattedAddress,
		dropoffFormattedAddress,
		packagePickupStartTime,
		packageDropoffStartTime
	} = params;
	console.log(packagePickupStartTime)
	console.log(packageDropoffStartTime)
	const payload = qs.stringify({
		'api_key': `${process.env.GOPHR_API_KEY}`,
		'pickup_address1': pickupFormattedAddress.street,
		'pickup_postcode': pickupFormattedAddress.postcode,
		'pickup_city': pickupFormattedAddress.city,
		'pickup_country_code': pickupFormattedAddress.countryCode,
		'size_x': '10',
		'size_y': '10',
		'size_z': '30',
		'weight': '12',
		...(packagePickupStartTime) && {'earliest_pickup_time': moment(packagePickupStartTime).toISOString()},
		...(packageDropoffStartTime) && {'earliest_delivery_time': moment(packageDropoffStartTime).toISOString()},
		'delivery_address1': dropoffFormattedAddress.street,
		'delivery_city': dropoffFormattedAddress.city,
		'delivery_postcode': dropoffFormattedAddress.postcode,
		'delivery_country_code': dropoffFormattedAddress.countryCode,
	});
	try {
		const config = {headers: {'Content-Type': 'application/x-www-form-urlencoded'}};
		const quoteURL = 'https://api-sandbox.gophr.com/v1/commercial-api/get-a-quote'
		let response = (await axios.post(quoteURL, payload, config)).data
		//error checking
		if (response.success) {
			let {price_net: price, delivery_eta: dropoffEta} = response.data;
			const quote = {
				...quoteSchema,
				id: `quote_${nanoid(15)}`,
				price,
				currency: 'GBP',
				dropoffEta: moment(dropoffEta).toISOString(),
				providerId: PROVIDERS.GOPHR,
				createdAt: moment().toISOString(),
				expireTime: moment().add(5, "minutes").toISOString(),
			}
			console.log(quote)
			return quote
		} else {
			console.log(response.error)
			throw response.error
		}
	} catch (err) {
		console.error(err)
		throw err
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
		packagePickupStartTime
	} = params;

	const payload = {
		job: {
			...(packagePickupStartTime) && { pickup_at: packagePickupStartTime },
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
						company: pickupBusinessName
					}
				}
			],
			dropoffs: [
				{
					...dropoffSchema,
					package_type: "medium",
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
					...(packageDropoffStartTime) && { end_customer_time_window_start: packageDropoffStartTime },
					...(packageDropoffEndTime) && { end_customer_time_window_end: packageDropoffEndTime }
				}
			]
		}
	}
	try {
		const config = {headers: {Authorization: `Bearer ${process.env.STUART_ACCESS_TOKEN}`}};
		const priceURL = "https://api.sandbox.stuart.com/v2/jobs/pricing"
		const etaURL = "https://api.sandbox.stuart.com/v2/jobs/eta"
		let {amount: price, currency} = (await axios.post(priceURL, payload, config)).data
		let {eta} = (await axios.post(etaURL, payload, config)).data
		const quote = {
			...quoteSchema,
			id: `quote_${nanoid(15)}`,
			price,
			currency,
			dropoffEta: moment().add(eta, "seconds").toISOString(),
			providerId: PROVIDERS.STUART,
			createdAt: moment().toISOString(),
			expireTime: moment().add(5, "minutes").toISOString(),
		}
		console.log(quote)
		return quote
	} catch (err) {
		console.error(err)
		if (err.response.status === ERROR_CODES.UNPROCESSABLE_ENTITY) {
			throw {code: err.response.status, ...err.response.data}
		} else {
			throw err
		}
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
		packageValue
	} = params;

	const payload = qs.stringify({
		'api_key': `${process.env.GOPHR_API_KEY}`,
		'external_id': `${refNumber}`,
		'pickup_person_name': `${pickupFirstName} + ' ' + ${pickupLastName}`,
		'pickup_mobile_number': `${pickupPhoneNumber}`,
		'pickup_company_name': `${pickupBusinessName}`,
		'pickup_email': pickupEmailAddress,
		'delivery_person_name': `${dropoffFirstName} + ' ' + ${dropoffLastName}`,
		'delivery_mobile_number': `${dropoffPhoneNumber}`,
		'delivery_company_name': `${dropoffBusinessName}`,
		'delivery_email': dropoffEmailAddress,
		'pickup_address1': pickupFormattedAddress.street,
		'pickup_city': pickupFormattedAddress.city,
		'pickup_postcode': pickupFormattedAddress.postcode,
		'pickup_country_code': pickupFormattedAddress.countryCode,
		'pickup_tips_how_to_find': pickupInstructions,
		'size_x': '10',
		'size_y': '10',
		'size_z': '30',
		'weight': '12',
		'earliest_pickup_time': packagePickupStartTime,
		'pickup_deadline': packagePickupEndTime,
		'earliest_delivery_time': packageDropoffStartTime,
		'dropoff_deadline': packageDropoffEndTime,
		'delivery_address1': dropoffFormattedAddress.street,
		'delivery_city': dropoffFormattedAddress.city,
		'delivery_postcode': dropoffFormattedAddress.postcode,
		'delivery_country_code': dropoffFormattedAddress.countryCode,
		'delivery_tips_how_to_find': dropoffInstructions,
		'order_value': packageValue
	});
	try {
		const config = {headers: {'Content-Type': 'application/x-www-form-urlencoded'}};
		const creatJobURL = 'https://api-sandbox.gophr.com/v1/commercial-api/create-confirm-job'
		const {data} = (await axios.post(creatJobURL, payload, config)).data
		console.log(data)
		const { job_id, public_tracker_url } = data
		return { id: job_id, trackingURL: public_tracker_url }
	} catch (err) {
		console.error(err)
		throw err
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
		packageDescription
	} = params;
	console.log(pickupAddress)
	console.log(dropoffAddress)
	const payload = {
		job: {
			pickup_at: moment(packagePickupStartTime, "DD/MM/YYYY hh:mm:ss"),
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
						company: pickupBusinessName
					}
				}
			],
			dropoffs: [
				{
					...dropoffSchema,
					package_type: "small",
					package_description: packageDescription,
					client_reference: refNumber,
					address: dropoffAddress,
					comment: dropoffInstructions,
					contact: {
						firstname: dropoffFirstName,
						lastname: dropoffLastName,
						phone: dropoffPhoneNumber,
						email: dropoffEmailAddress,
						company: dropoffBusinessName
					},
					end_customer_time_window_start: packageDropoffStartTime,
					end_customer_time_window_end: packageDropoffEndTime
				}
			]
		}
	}
	try {
		const baseURL = "https://api.sandbox.stuart.com"
		const path = "/v2/jobs";
		let URL = baseURL + path
		const config = {headers: {Authorization: `Bearer ${process.env.STUART_ACCESS_TOKEN}`}};
		let data = (await axios.post(URL, payload, config)).data
		console.log(data)
		return { id: String(data.id), trackingURL: data.deliveries[0].tracking_url }
	} catch (err) {
		console.error(err)
		throw err
	}
}

module.exports = {
	genJobReference,
	getClientSelectionStrategy,
	chooseBestProvider,
	genOrderNumber,
	getResultantQuotes,
	providerCreatesJob
}