require('dotenv').config();
const express = require("express")
const { clients } = require("../data");
const { AUTHORIZATION_KEY } = require("../constants");
const db = require('../models');

const validateApiKey = async (req, res, next) => {
	let isValid = false
	console.log("validating apikey")
	try {
		const apiKey = req.headers[AUTHORIZATION_KEY]
		if (apiKey === undefined) {
			return res.status(401).json({
				code: 401,
				message: "UNAUTHORIZED",
				description: "API key is MISSING"
			})
		}
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