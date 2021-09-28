require("dotenv").config();
const express = require("express");
const moment = require("moment");
const mongoose = require("mongoose");
const axios = require('axios');
const orderid = require('order-id')('seconds')
const {customAlphabet} = require("nanoid");
const {
	genJobReference,
	getClientSelectionStrategy,
	providerCreatesJob,
	chooseBestProvider,
	genOrderNumber,
	getResultantQuotes
} = require("./helpers");
const db = require('../models');
const {alphabet, STATUS, AUTHORIZATION_KEY, PROVIDER_ID, PROVIDERS} = require("../constants");

/**
 * The first entry point to Seconds API service,
 * it creates a new job with delivery requirements
 */
const nanoid = customAlphabet(alphabet, 24)

exports.createJob = async (req, res) => {
	try {
		const {
			pickupAddress,
			pickupFormattedAddress,
			pickupPhoneNumber,
			pickupEmailAddress,
			pickupBusinessName,
			pickupFirstName,
			pickupLastName,
			pickupInstructions,
			dropoffAddress,
			dropoffFormattedAddress,
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
		const selectedProvider = req.headers[PROVIDER_ID]
		console.log("---------------------------------------------")
		console.log("KEY:", apiKey);
		console.log("---------------------------------------------")
		console.log("SELECTED PROVIDER:", selectedProvider)
		console.log("---------------------------------------------")
		const selectionStrategy = await getClientSelectionStrategy(apiKey);
		const QUOTES = await getResultantQuotes(req.body);
		// Use selection strategy to select the winner quote
		const bestQuote = chooseBestProvider(selectionStrategy, QUOTES);
		// based on selected quote call selected provider api or use client's requested provider id is specified

		// checks if the fleet provider for the delivery was manually selected or not
		let providerId;
		console.log(selectedProvider === PROVIDERS.UNKNOWN)
		if (selectedProvider === PROVIDERS.UNKNOWN) {
			providerId = bestQuote.providerId
		} else {
			providerId = selectedProvider
		}

		const {
			id: spec_id,
			trackingURL,
			pickupAt,
			dropoffAt
		} = await providerCreatesJob(providerId.toLowerCase(), clientRefNumber, req.body)

		const jobs = await db.Job.find({})

		let job = {
			createdAt: moment().toISOString(),
			jobSpecification: {
				id: spec_id,
				orderNumber: genOrderNumber(jobs.length),
				packages: [{
					description: packageDescription,
					dropoffLocation: {
						fullAddress: dropoffAddress,
						street_address: dropoffFormattedAddress.street,
						city: dropoffFormattedAddress.city,
						postcode: dropoffFormattedAddress.postcode,
						country: "UK",
						phoneNumber: dropoffPhoneNumber,
						email: dropoffEmailAddress,
						firstName: dropoffFirstName,
						lastName: dropoffLastName,
						businessName: dropoffBusinessName,
						instructions: dropoffInstructions
					},
					dropoffStartTime: dropoffAt ? moment(dropoffAt).toISOString() : packageDropoffStartTime,
					dropoffEndTime: packageDropoffEndTime,
					itemsCount,
					pickupStartTime: pickupAt ? moment(pickupAt).toISOString() : packagePickupStartTime,
					pickupEndTime: packagePickupEndTime,
					pickupLocation: {
						fullAddress: pickupAddress,
						street_address: pickupFormattedAddress.street,
						city: pickupFormattedAddress.city,
						postcode: pickupFormattedAddress.postcode,
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
				providerId,
				trackingURL,
				quotes: QUOTES
			},
			status: STATUS.NEW,
		}
		// Append the selected provider job to the jobs database
		const createdJob = await db.Job.create({...job})
		// Add the delivery to the database
		await db.User.updateOne({apiKey}, {$push: {jobs: createdJob._id}}, {new: true})
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
		const {job_id} = req.params;
		let {_doc: {_id, ...foundJob}} = await db.Job.findById(job_id, {})
		if (foundJob) {
			return res.status(200).json({
				jobId: job_id,
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
 * Get Quotes - The API endpoint for retrieving the bestQuote and the list of quotes from relative providers
 * @constructor
 * @param req - request object
 * @param res - response object
 * @returns {Promise<*>}
 */
exports.getQuotes = async (req, res) => {
	try {
		const selectionStrategy = await getClientSelectionStrategy(req.headers[AUTHORIZATION_KEY]);
		console.log("Strategy: ", selectionStrategy)
		const quotes = await getResultantQuotes(req.body);
		const bestQuote = chooseBestProvider(selectionStrategy, quotes);
		return res.status(200).json({
			quotes,
			bestQuote
		})
	} catch (err) {
		return res.status(500).json({
			...err
		})
	}
}

exports.updateStatus = async (req, res) => {
	const {status} = req.body;
	const {job_id} = req.params;
	try {
		console.log(req.body)
		if (!Object.keys(req.body).length) {
			return res.status(400).json({
				code: 400,
				description: "Your payload has no properties to update the job",
				message: "Missing Payload!"
			})
		}
		await db.Job.findByIdAndUpdate(job_id, {"status": status}, {new: true})
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
		dropoffInstructions
	} = req.body
	console.log(req.body)
	try {
		let jobId = req.params["job_id"]
		if (mongoose.Types.ObjectId.isValid(jobId)) {
			let {_doc: {_id, ...updatedJob}} = await db.Job.findOneAndUpdate({_id: jobId}, {
				'$set': {
					"jobSpecification.packages.$[].description": description,
					"jobSpecification.packages.$[].pickupLocation.instructions": pickupInstructions,
					"jobSpecification.packages.$[].dropoffLocation.instructions": dropoffInstructions
				},
			}, {
				new: true,
				sanitizeProjection: true,
			})
			return updatedJob ?
				res.status(200).json({
					jobId: _id,
					...updatedJob
				}) : res.status(404).json({
					code: 404,
					description: `No job found with ID: ${jobId}`,
					message: "Not Found"
				})
		} else {
			res.status(404).json({
				code: 404,
				description: `No job found with ID: ${jobId}`,
				message: "Not Found"
			})
		}
	} catch
		(e) {
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
exports.cancelJob = async (req, res) => {
	try {
		const jobId = req.params["job_id"]
		let foundJob = await db.Job.findByIdAndUpdate(jobId, {"status": STATUS.CANCELLED}, {new: true})
		console.log(foundJob)
		if (foundJob) {
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
 * @param next - moves to the next helper function
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
