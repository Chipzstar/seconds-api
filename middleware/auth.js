require('dotenv').config();
const express = require("express")
const { clients } = require("../data");
const { AUTHORIZATION_KEY, AUTH_KEYS} = require("../constants");
const db = require('../models');

const validateApiKey = async (req, res, next) => {
	let isValid = false
	console.log("validating apikey")
	try {
		const apiKey = req.headers[AUTHORIZATION_KEY]
		console.log(apiKey)
		if (apiKey === undefined || apiKey === "") {
			return res.status(401).json({
				code: 401,
				message: "UNAUTHORIZED",
				description: "API key is MISSING"
			})
		}
		// check if the incoming request is from a fleet provider
		if (apiKey === AUTH_KEYS.STUART) {
			console.log("API Key is valid!")
			isValid = true
		}
		// check if incoming request is from a client
		const client = await db.User.findOne({ "apiKey": apiKey }, {})
		if (client) {
			console.log("API Key is valid!")
			isValid = true
		}
		return isValid ? next() : res.status(401).json({
			code: 401,
			message: "UNAUTHORIZED",
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