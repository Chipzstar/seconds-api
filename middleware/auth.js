require('dotenv').config();
const express = require("express")
const { AUTHORIZATION_KEY } = require("../constants");
const db = require('../models');

const validateApiKey = async (req, res, next) => {
	let isValid = false
	try {
		const apiKey = req.headers[AUTHORIZATION_KEY]
		console.log({apiKey})
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