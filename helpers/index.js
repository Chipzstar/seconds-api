require("dotenv").config();
const express = require("express");
const moment = require("moment");
const axios = require('axios');
const orderid = require('order-id')('seconds')
const {customAlphabet} = require("nanoid");
const {genJobReference, genDummyQuote, getClientSelectionStrategy, getStuartQuote, providerCreatesJob, chooseBestProvider, genOrderNumber, getGophrQuote, getResultantQuotes} = require("./helpers");
const {jobs} = require('../data');
const db = require('../models');
const {alphabet, STATUS, AUTHORIZATION_KEY} = require("../constants");

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
		//fetch api key
		//generate client reference number
		const clientRefNumber = genJobReference();
		const apiKey = req.headers[AUTHORIZATION_KEY];
		console.log("KEY:", apiKey);
		const selectionStrategy = await getClientSelectionStrategy(apiKey, clientRefNumber);
		const QUOTES = await getResultantQuotes(req.body);
		// Use selection strategy to select the winner quote
		const bestQuote = chooseBestProvider(selectionStrategy, QUOTES);
		//generate new order number
		//const orderId = orderid.generate();
		// based on selected quote call selected provider api
		const providerId = await providerCreatesJob(bestQuote.providerId, clientRefNumber, req.body)
		const jobs = await db.Job.find({})
		let job = {
			createdAt: moment().toISOString(),
			jobSpecification: {
				id: providerId,
				orderNumber: genOrderNumber(jobs.length),
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
				jobReference: clientRefNumber,
				createdAt: moment().toISOString(),
				delivery: packageDeliveryMode,
				winnerQuote: bestQuote.id,
				providerId: bestQuote.providerId,
				quotes: QUOTES
			},
			status: STATUS.NEW,
		}
		// Append the selected provider job to the jobs database
		const createdJob = await db.Job.create({...job})
		console.log(createdJob)
		// Add the delivery to the database
		const updatedClient = await db.User.updateOne({apiKey}, {$push: {jobs: createdJob._id}}, {new: true})
		console.log(updatedClient)
		return res.status(200).json({
			jobId: createdJob._id,
			...job,
		})
	} catch (e) {
		console.error("ERROR:", e)
		if (e.message) {
			return res.status(e.code).json({
				error: e
			})
		}
		return res.status(500).json({
			code: 500,
			message: "Unknown error occurred!"
		});
	}
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
 * Get Quotes - The API endpoint for retreiving the bestQuote and the list of quotes from relative providers
 * @constructor
 * @param req - request object
 * @param res - response object
 * @returns {Promise<*>}
 */
exports.getQuotes = async (req, res) => {
	console.log(req.body)
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
		  packageDropoffStartTime,
		  packageDropoffEndTime,
		  packagePickupStartTime,
		  packagePickupEndTime,
		  packageDescription,
		  packageValue,
		  itemsCount,
	   } = req.body;
	   const selectionStrategy = await getClientSelectionStrategy(req.headers[AUTHORIZATION_KEY]);
	   const QUOTES = await getResultantQuotes(req.body);
	   const bestQuote = chooseBestProvider(selectionStrategy, QUOTES);
	   return res.status(200).json({
		  quotes: QUOTES,
		  bestQuote
	   })
	} catch (err) {
	   return res.status(500).json({
		  ...err
	   })
	}
}

exports.updateStatus = async (req, res, next) => {
	const { status } = req.body;
	const { job_id } = req.params;
	try {
		console.log(req.body)
		if (!Object.keys(req.body).length) {
			return res.status(400).json({
				code: 400,
				description: "Your payload has no properties to update the job",
				message: "Missing Payload!"
			})
		}
		let job = await db.Job.findByIdAndUpdate(job_id, {"status": status}, {new: true})
		let jobs = await db.Job.find({}, {}, {new: true})
		console.log(jobs)
		return res.status(200).json({
			updatedJobs: jobs,
			message: "Job status updated!"
		})
	} catch (e) {
		return res.status(404).json({
			code: 404,
			description: `No job found with ID: ${job_id}`,
			message: "Not Found"
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
	console.log(req.body)
	if (!Object.keys(req.body).length) {
		return res.status(400).json({
			code: 400,
			description: "Your payload has no properties to update the job",
			message: "Missing Payload!"
		})
	}
	const {
		status,
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

/**
 * List Jobs - The API endpoint for listing all jobs currently in progress
 * @constructor
 * @param req - request object
 * @param res - response object
 * @returns {Promise<*>}
 */
exports.listJobs = async (req, res, next) => {
	try {
		const {email} = req.body;
		const user = await db.User.findOne({"email": email}, {})
		const jobs = []
		for (let jobId of user.jobs) {
			const job = await db.Job.findById(jobId, {}, {new: true})
			if (job) {
				console.log(job["_doc"])
				jobs.push({...job["_doc"]})
			}
		}
		return res.status(200).json({
			jobs,
			message: "All jobs returned!"
		})
	} catch (err) {
		console.error(err)
		return next({
			status: 400,
			message: err.message
		})
	}
}
