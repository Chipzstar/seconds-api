require("dotenv").config();
const express = require("express");
const moment = require("moment");
const {customAlphabet} = require("nanoid")
const {checkApiKey} = require("./helpers");
const {jobs} = require('../data')

/**
 * The first entry point to Seconds API service,
 * it creates a new job with delivery requirements
 */
const numbers = '1234567890'
const lowerCase = 'abcdefghijklmnopqrstuvwxyz'
const upperCase = lowerCase.toUpperCase()
const symbols = '~!@$^&*()-+{}][|,./;:\''
const alphabet = String(numbers + numbers + lowerCase + upperCase + symbols)
const nanoid = customAlphabet(alphabet, 24)

/**
 * Create Job - The initial API endpoint for creating new delivery jobs
 * @constructor
 * @param req - request object
 * @param res - response object
 * @returns {Promise<*>}
 */
exports.createJob = async (req, res) => {
	const {
		pickupAddress,
		pickupPhoneNumber,
		pickupBusinessName,
		pickupFirstName,
		pickupLastName,
		pickupInstructions,
		dropoffAddress,
		dropoffPhoneNumber,
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
		itemsCount,
	} = req.body;
	const {authorization} = req.headers;
	if (authorization === undefined) {
		return res.status(404).json({
			code: 404,
			message: "No valid API key provided!"
		})
	}
	if (checkApiKey(authorization)) {
		let response = {
			createdAt: moment.now(),
			id: `job_${nanoid()}`,
			jobSpecification: {
				id: `spec_${nanoid()}`,
				packages: [{
					description: packageDescription,
					dropoffLocation: {
						address: dropoffAddress,
						city: "Hull",
						postcode: "HU9 9JF",
						country: "UK",
						phoneNumber: dropoffPhoneNumber,
						email: null,
						firstName: dropoffFirstName,
						lastName: dropoffLastName,
						businessName: dropoffBusinessName,
						instructions: dropoffInstructions
					},
					dropoffStartTime: packageDropoffStartTime,
					dropoffEndTime: packageDropoffEndTime,
					itemsCount,
					pickupStartTime: packagePickupStartTime,
					pickupEndTime: packagePickupEndTime,
					pickupLocation: {
						address: pickupAddress,
						city: "Plymouth",
						postcode: "PL2 2PB",
						country: "UK",
						phoneNumber: pickupPhoneNumber,
						email: null,
						firstName: pickupFirstName,
						lastName: pickupLastName,
						businessName: pickupBusinessName,
						instructions: pickupInstructions
					},
					tax: packageTax,
					value: packageValue
				}]
			},
			selectedConfiguration: {
				createdAt: "2021-06-22T18:16:54.025917",
				tasks: [
					{
						delivery: packageDeliveryMode,
						id: `task_${nanoid()}`,
						providerId: null,
						quotes: [
							{
								createdTime: "2021-06-22T18:16:56",
								currency: "GBP",
								dropoffEta: "2021-09-22T19:52:56",
								expireTime: "2021-09-22T18:21:56",
								id: `quote_${nanoid()}`,
								pickupWindow: "2021-06-22T18:16:56.361353",
								price: 13.04,
								providerId: "partner_1"
							}]
					}]
			},
			status: "CREATED",
		}
		jobs.push(response)
		console.log("Num jobs:", jobs.length)
		return res.status(200).json({
			...response
		})
	}
	return res.status(403).json({
		code: 403,
		message: "The API key doesn't have permissions to perform the request."
	});
}

/**
 * Get Job - The API endpoint for retrieving created delivery jobs
 * @constructor
 * @param req - request object
 * @param res - response object
 * @returns {Promise<*>}
 */
exports.getJob = async (req, res) => {
	const {authorization} = req.headers;
	if (checkApiKey(authorization)) {
		let foundJob = jobs.find(job => job.id === req.params["job_id"])
		if (foundJob) {
			return res.status(200).json({
				...foundJob
			})
		} else {
			return res.status(404).json({
				code: 404,
				description: `No job found with ID: ${req.params["job_id"]}`,
				message: "Not Found"
			})
		}
	} else {
		return res.status(401).json({
			code: 401,
			description: `Invalid API key`,
			message: "Unauthorized"
		})
	}
}
/**
 * Update Job - The API endpoint for updating details of a delivery job
 * @param req - request object
 * @param res - response object
 * @returns {Promise<*>}
 */
exports.updateJob = async (req, res) => {
	if (!Object.keys(req.body).length) {
		return res.status(400).json({
			code: 400,
			description: "Your payload has no properties to update the job",
			message: "Missing Payload!"
		})
	}
	const {
		packageDescription: description,
		pickupInstructions,
		dropoffInstructions,
		packageTax: tax,
		packageValue: value,
		itemsCount,
	} = req.body;
	const {authorization} = req.headers;
	if (checkApiKey(authorization)) {
		let jobIndex = jobs.findIndex(job => job.id === req.params["job_id"])
		if (jobIndex !== -1) {
			jobs.forEach((job, index) => {
				if (jobIndex === index) {
					// update the specific job
					console.log(job)
					jobs[index] = {
						...job,
						jobSpecification: {
							...job.jobSpecification,
							packages: [
								{
									...job.jobSpecification.packages[0],
									description,
									pickupLocation: {
										...job.jobSpecification.packages[0].pickupLocation,
										instructions: pickupInstructions
									},
									dropoffLocation: {
										...job.jobSpecification.packages[0].dropoffLocation,
										instructions: dropoffInstructions
									},
									value,
									tax,
									itemsCount,
								}
							]
						}
					}
				}
			})
			return res.status(200).json({
				...jobs[jobIndex]
			})
		} else {
			return res.status(404).json({
				code: 404,
				description: `No job found with ID: ${req.params["job_id"]}`,
				message: "Not Found"
			})
		}
	} else {
		return res.status(401).json({
			code: 401,
			description: `Invalid API key`,
			message: "Unauthorized"
		})
	}
}

/**
 * Delete Job - The API endpoint for cancelling a delivery job
 * @param req - request object
 * @param res - response object
 * @returns {Promise<*>}
 */
exports.deleteJob = async (req, res) => {
	const {authorization} = req.headers;
	const jobId = req.params["job_id"]
	if (checkApiKey(authorization)) {
		let jobIndex = jobs.findIndex(job => job.id === jobId)
		if (jobIndex !== -1) {
			jobs.splice(jobIndex, 1)
			console.log("Num jobs:", jobs.length)
			return res.status(200).json({
				job_id: jobId,
				cancelled: true
			})
		} else {
			return res.status(404).json({
				code: 404,
				description: `No job found with ID: ${jobId}`,
				message: "Not Found"
			})
		}
	} else {
		return res.status(401).json({
			code: 401,
			description: `Invalid API key`,
			message: "Unauthorized"
		})
	}
}