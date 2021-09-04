const {clients} = require('../data')
const axios = require("axios");
const {JobRequestSchema, pickupSchema, dropoffSchema} = require("../schemas/stuart");
const crypto = require("crypto");
const moment = require("moment");
const {dummyQuote, dummyDelivery} = require("../schemas/dummyQuote");
const {nanoid} = require("nanoid");

function checkApiKey(apiKey) {
	let isValid = false
	clients.forEach(client => {
		if (client.apiKey === apiKey) {
			console.log("API Key is valid!")
			isValid = true
		}
	})
	return isValid
}

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

function genReferenceNumber() {
	const rand = crypto.randomBytes(16);
	let chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789".repeat(2)

	let str = '';

	for (let i = 0; i < rand.length; i++) {
		let index = rand[i] % chars.length;
		str += chars[index];
	}
	console.log("Generated Reference Number:", str);
	return str;
}

function genDummyQuote(refNumber, params){
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
		dropoffBusinessName,
		dropoffFirstName,
		dropoffLastName,
		dropoffEmailAddress,
		dropoffInstructions,
		package, DeliveryMode,
		packageDropoffStartTime,
		packageDropoffEndTime,
		packagePickupStartTime,
		packagePickupEndTime,
		packageDescription,
	} = params;

	let distance = (Math.random() * (15 - 2) + 2).toFixed(3);
	let duration = Math.floor(Math.random() * (30 - 10) + 10);

	let quote = {
		...dummyQuote,
		assignment_code: genAssignmentCode(),
		pickup_at: packagePickupStartTime,
		dropoff_at: packageDropoffStartTime,
		distance,
		duration,  //in minutes
		deliveries: [{
			...dummyDelivery,
			client_reference: refNumber,
			package_description: packageDescription,
			pickup: {
				id: nanoid(7),
				address: pickupAddress,
				comment: pickupInstructions,
				contact: {
					firstname: pickupFirstName,
					lastname: pickupLastName,
					phone: pickupPhoneNumber,
					email: pickupEmailAddress,
					company_name: pickupBusinessName
				}
			},
			dropoff: {
				id: nanoid(7),
				address: dropoffAddress,
				comment: dropoffInstructions,
				contact: {
					firstname: dropoffFirstName,
					lastname: dropoffLastName,
					phone: dropoffPhoneNumber,
					email: dropoffEmailAddress,
					company_name: dropoffBusinessName
				}
			},
			eta: {
				pickup: moment().add(Math.floor(duration / 2), 'minutes').toISOString(),
				dropoff: moment().add(duration, 'minutes').toISOString()
			},
		}],
	}
	return {
		...quote
	}
}
async function stuartProviderRequest(refNumber, params) {
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
		package, DeliveryMode,
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
			pickup_at: moment('05/09/2021 09:15:00', "DD/MM/YYYY hh:mm:ss"),
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
		const config = { headers: { Authorization: `Bearer ${process.env.STUART_ACCESS_TOKEN}` } };
		console.log(URL)
		return (await axios.post(URL, payload, config)).data
	} catch (err) {
		console.error(err)
		throw err
	}
}

module.exports = {checkApiKey, stuartProviderRequest, genReferenceNumber, genDummyQuote}