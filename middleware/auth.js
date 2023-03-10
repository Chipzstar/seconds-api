require('dotenv').config();
const { AUTHORIZATION_KEY } = require("@seconds-technologies/database_schemas/constants");
const db = require('../models');

const validateApiKey = async (req, res, next) => {
	let isValid = false
	try {
		const apiKey = req.headers[AUTHORIZATION_KEY]
		if (apiKey === undefined || apiKey === "") {
			return res.status(401).json({
				code: 401,
				message: "UNAUTHORIZED",
				description: "API key is MISSING"
			})
		}
		/**
		 * check if the incoming request is from a fleet provider
		 */
		// TRACKING LINK API KEY
		if (apiKey === process.env.TRACKING_API_KEY) {
			isValid = true;
		}
		//STUART
		if (apiKey === process.env.STUART_WEBHOOK_KEY) {
			isValid = true
		}
		// check if incoming request is from a CLIENT
		const client = await db.User.findOne({ "apiKey": apiKey }, {})
		if (client) {
			isValid = true
		}
		// check if incoming request is from a DRIVER
		const driver = await db.Driver.findOne({ "apiKey": apiKey }, {})
		if (driver) {
			isValid = true
		}
		return isValid ? next() : res.status(403).json({
			code: 403,
			message: "FORBIDDEN",
			description: "API Key is INVALID"
		})
	} catch (err) {
		console.error(err)
		return res.status(500).json({
			...err
		})
	}
}

module.exports = {validateApiKey}