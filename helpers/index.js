require("dotenv").config();
const express = require("express");
const moment = require("moment");
const axios = require('axios');
const {customAlphabet} = require("nanoid");
const {genReferenceNumber, genDummyQuote, getStuartQuote, chooseBestProvider} = require("./helpers");
const { jobs } = require('../data');
const db = require('../models');
const {alphabet, DELIVERY_STATUS, AUTHORIZATION_KEY} = require("../constants");

/**
 * The first entry point to Seconds API service,
 * it creates a new job with delivery requirements
 */
const nanoid = customAlphabet(alphabet, 24)

exports.createJob = async (req, res) => {
	try {
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
			itemsCount,
		} = req.body;
		const apiKey = req.headers[AUTHORIZATION_KEY];
		const QUOTES = []
		const foundClient = await db.User.findOne({ "apiKey": apiKey }, {})
		console.log(foundClient)
		// lookup the selection strategy
		let selectionStrategy = foundClient["selectionStrategy"]
		//generate client reference number
		let clientRefNumber = genReferenceNumber();
		// QUOTE AGGREGATION
		// send delivery request to integrated providers
		let stuartQuote = await getStuartQuote(clientRefNumber, req.body)
		QUOTES.push(stuartQuote)
		// create dummy quotes
		let dummyQuote1 = genDummyQuote(clientRefNumber, "dummy_provider_1")
		QUOTES.push(dummyQuote1)
		let dummyQuote2 = genDummyQuote(clientRefNumber, "dummy_provider_2")
		QUOTES.push(dummyQuote2)
		let dummyQuote3 = genDummyQuote(clientRefNumber, "dummy_provider_3")
		QUOTES.push(dummyQuote3)
		// Use selection strategy to select the winner quote
		let bestQuote = chooseBestProvider(selectionStrategy, QUOTES)
		console.log({bestQuote})

		let job = {
			createdAt: moment().toISOString(),
			jobId: `job_${nanoid()}`,
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
						email: dropoffEmailAddress,
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
						email: pickupEmailAddress,
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
				createdAt: moment().toISOString(),
				delivery: packageDeliveryMode,
				winnerQuote: bestQuote.id,
				providerId: bestQuote.providerId,
				quotes: QUOTES
			},
			status: DELIVERY_STATUS.CREATED,
		}
		// Append the selected provider job to the jobs database
		const createdJob = db.Job.create({...job})
		console.log(createdJob)
		// Add the delivery to the database
		const updatedClient = await db.User.updateOne({ apiKey }, { $push: { jobs: job.jobId }}, { new: true})
		console.log(updatedClient)
		return res.status(200).json({
			...job
		})
	} catch (e) {
		return res.status(400).json({
			code: 400,
			message: "Unknown error occurred!"
		});
	}
}
/**
 * List Jobs - The API endpoint for listing all jobs currently in progress
 * @constructor
 * @param req - request object
 * @param res - response object
 * @returns {Promise<*>}
 */
exports.listJobs = async (req, res) => {
	return res.status(200).json({
		jobs
	})
}
/**
 * Get Job - The API endpoint for retrieving created delivery jobs
 * @constructor
 * @param req - request object
 * @param res - response object
 * @returns {Promise<*>}
 */
exports.getJob = async (req, res) => {
	try {
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
	} catch (err) {
		return res.status(500).json({
			...err
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
	try {
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
	} catch (e) {
		console.error(e)
		return res.status(500).json({
			...e
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
	try {
		const jobId = req.params["job_id"]
		let jobIndex = jobs.findIndex(job => job.id === jobId)
		if (jobIndex !== -1) {
			jobs.splice(jobIndex, 1)
			console.log("Num jobs:", jobs.length)
			return res.status(200).json({
				jobId,
				cancelled: true
			})
		} else {
			return res.status(404).json({
				code: 404,
				description: `No job found with ID: ${jobId}`,
				message: "Not Found"
			})
		}
	} catch (err) {
		console.error(err)
		return res.status(500).json({
			...err
		})
	}
}
