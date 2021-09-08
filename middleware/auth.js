require('dotenv').config();
const express = require("express")
const {clients} = require("../data");

const validateApiKey = (req, res, next) => {
	let isValid = false
	console.log("validating apikey")
	try {
		const {authorization: apiKey} = req.headers;
		if (apiKey === undefined) {
			return res.status(401).json({
				code: 401,
				message: "UNAUTHORIZED",
				description: "API key is MISSING"
			})
		}
		clients.forEach(client => {
			if (client.apiKey === apiKey) {
				console.log("API Key is valid!")
				isValid = true
			}
		})
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