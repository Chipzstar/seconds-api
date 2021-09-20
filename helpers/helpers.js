const axios = require("axios");
const {JobRequestSchema, pickupSchema, dropoffSchema} = require("../schemas/stuart/CreateJob");
const qs = require("qs");
const crypto = require("crypto");
const moment = require("moment-timezone");
const {nanoid} = require("nanoid");
const {quoteSchema} = require("../schemas/quote");
const { SELECTION_STRATEGIES, ERROR_CODES } = require("../constants");

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

function calculateFare(distance) {
	let fare = 0.0
	if (distance > 1) {
		fare = fare + 3.5
	}
	if (distance > 10) {
		fare = fare + 1
	}
	fare = fare + (distance * 1.50) + 0.25
	return fare.toFixed(2)
}

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
		//console.log({providerId, duration})
		if (duration < bestEta) {
			bestEta = duration
			bestEtaIndex = index
		}
	})
	if (strategy === SELECTION_STRATEGIES.PRICE){
		return quotes[bestPriceIndex]
	} else {
		return quotes[bestEtaIndex]
	}
}

function genOrderNumber(number){
	return number.toString().padStart(4, "0")
}

function genDummyQuote(refNumber, providerId) {
	let distance = (Math.random() * (15 - 2) + 2).toFixed(2);
	let duration = Math.floor(Math.random() * (3600 - 600) + 600);
	let quote = {
		...quoteSchema,
		createdAt: moment().toISOString(),
		id: `quote_${nanoid(15)}`,
		dropoffEta: moment().add(duration, "seconds").toISOString(),
		expireTime: moment().add(5, "minutes").toISOString(),
		price: calculateFare(distance),
		currency: "GBP",
		providerId,
	}
	//console.log(quote)
	return {
		...quote
	}
}

async function getGophrQuote(refNumber, params)	{
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
		packageDeliveryMode,
		packageDropoffStartTime,
		packageDropoffEndTime,
		packagePickupStartTime,
		packagePickupEndTime,
		packageDescription,
		packageValue,
		packageTax,
		itemsCount
	} = params;
	const payload = qs.stringify({
		'api_key': 'sand-1c8d46f1-0ddf-11ec-9428-42010a840077',
		'pickup_address1': '9 White Lion Street',
		'pickup_postcode': 'N1 9PD',
		'pickup_city': 'London',
		// 'pickup_country_code': 'GBR',
		'size_x': '10',
		'size_y': '10',
		'size_z': '30',
		'weight': '12',
		// 'earliest_pickup_time': packagePickupStartTime,
		'delivery_address1': '250 Reede Road',
		'delivery_city': 'Dagenham',
		'delivery_postcode': 'RM10 8EH',
		// 'delivery_country_code': 'GBR'
	});
	try {
		const config = {headers: {'Content-Type': 'application/x-www-form-urlencoded'}};
		const quoteURL = 'https://api-sandbox.gophr.com/v1/commercial-api/get-a-quote'
		let { data } = (await axios.post(quoteURL, payload, config)).data
		let { price_net:price, delivery_eta:dropoffEta } = data;
		const quote = {
			...quoteSchema,
			id: `quote_${nanoid(15)}`,
			price,
			currency: 'GBP',
			dropoffEta,
			providerId: 'Gophr',
			createdAt: moment().toISOString(),
			expireTime: moment().add(5, "minutes").toISOString(),
		}
		console.log(quote)
		return quote
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
		packageDeliveryMode,
		packageDropoffStartTime,
		packageDropoffEndTime,
		packagePickupStartTime,
	} = params;
	console.log("Time:", packagePickupStartTime)
	const payload = {
		job: {
			...JobRequestSchema,
			pickup_at: moment(packagePickupStartTime).format("DD/MM/YYYY HH:mm:ss"),
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
					package_description: "Gaming console",
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
					end_customer_time_window_start: packageDropoffStartTime,
					end_customer_time_window_end: packageDropoffEndTime
				}
			]
		}
	}
	try {
		const config = {headers: {Authorization: `Bearer ${process.env.STUART_ACCESS_TOKEN}`}};
		const priceURL = "https://api.sandbox.stuart.com/v2/jobs/pricing"
		const etaURL = "https://api.sandbox.stuart.com/v2/jobs/eta"
		let { amount:price, currency } = (await axios.post(priceURL, payload, config)).data
		let { eta } = (await axios.post(etaURL, payload, config)).data
		const quote = {
			...quoteSchema,
			id: `quote_${nanoid(15)}`,
			price,
			currency,
			dropoffEta: moment().add(eta, "seconds").toISOString(),
			providerId: "Stuart",
			createdAt: moment().toISOString(),
			expireTime: moment().add(5, "minutes").toISOString(),
		}
		console.log(quote)
		return quote
	} catch (err) {
		console.error(err)
		if (err.response.status === ERROR_CODES.UNPROCESSABLE_ENTITY){
			throw { code: err.response.status, ...err.response.data }
		} else {
			throw err
		}
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
		packageDeliveryMode,
		packageDropoffStartTime,
		packageDropoffEndTime,
		packagePickupStartTime,
		packagePickupEndTime,
		packageDescription,
		packageValue,
		packageTax,
		itemsCount
	} = params;

	const payload = {
		job: {
			...JobRequestSchema,
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
					package_type: "medium",
					package_description: "Gaming console",
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
		console.log(URL)
		return (await axios.post(URL, payload, config)).data
	} catch (err) {
		console.error(err)
		throw err
	}
}

module.exports = { genJobReference, genDummyQuote, getStuartQuote, chooseBestProvider, genOrderNumber }