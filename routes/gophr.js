const express = require("express");
const {JOB_STATUS, WEBHOOK_TYPES } = require("../constants/gophr");
const {STATUS } = require("../constants");
const db = require("../models");
const moment = require("moment");
const router = express.Router();

function translateGophrStatus(value) {
	switch (value) {
		case JOB_STATUS.NEW:
			return STATUS.NEW
		case JOB_STATUS.PENDING:
			return STATUS.PENDING
		case JOB_STATUS.ACCEPTED:
			return STATUS.DISPATCHING
		case JOB_STATUS.AT_PICKUP:
			return STATUS.DISPATCHING
		case JOB_STATUS.EN_ROUTE:
			return STATUS.EN_ROUTE
		case JOB_STATUS.AT_DELIVERY:
			return STATUS.EN_ROUTE
		case JOB_STATUS.COMPLETED:
			return STATUS.COMPLETED
		case JOB_STATUS.CANCELLED:
			return STATUS.CANCELLED
		default:
			return value
	}
}

async function updateStatus(data){
	try {
		console.log(data)
		const {status: STATUS, external_id: REFERENCE, pickup_eta, delivery_eta, courier_name } = data
		console.log({STATUS, REFERENCE})
		// update the status for the current job
		await db.Job.findOneAndUpdate(
			{"selectedConfiguration.jobReference": REFERENCE},
			{"status": translateGophrStatus(STATUS)},
			{new: true}
		)
		let {_doc: { _id, ...job} } = await db.Job.findOneAndUpdate(
			{"selectedConfiguration.jobReference": REFERENCE},
			{
				'$set': {
					"jobSpecification.packages.$[].pickupStartTime": moment(pickup_eta).toISOString(true),
					"jobSpecification.packages.$[].dropoffStartTime": moment(delivery_eta).toISOString(true),
					"driverInformation.name": courier_name
				},
			}, {
				new: true,
				sanitizeProjection: true,
			})
		console.log(job)
		return STATUS
	} catch (err) {
		console.error(err)
		throw err
	}
}

async function updateETA(data){
	console.log(data)
	const {external_id: REFERENCE, pickup_eta, delivery_eta } = data
	console.log({ REFERENCE })
	// update the status for the current job
	let {_doc: { _id, ...job} } = await db.Job.findOneAndUpdate(
		{"selectedConfiguration.jobReference": REFERENCE},
		{
			'$set': {
				"jobSpecification.packages.$[].pickupStartTime": moment(pickup_eta).toISOString(true),
				"jobSpecification.packages.$[].dropoffStartTime": moment(delivery_eta).toISOString(true),
			},
		}, {
			new: true,
			sanitizeProjection: true,
		})
	console.log(job)
	return {pickup_eta, delivery_eta}
}

router.post("/", async (req, res) => {
	try {
		// GOPHR
		const {api_key, webhook_type } = req.body;
		if (api_key === String(process.env.GOPHR_API_KEY)) {
			if (webhook_type === WEBHOOK_TYPES.STATUS) {
				let jobStatus = await updateStatus(req.body)
				console.log("--------------------------------")
				console.log("NEW STATUS:", jobStatus)
				console.log("--------------------------------")
			} else if (webhook_type === WEBHOOK_TYPES.ETA){
				let jobETA = await updateETA(req.body)
				console.log("--------------------------------")
				console.log("NEW ETA:", jobETA)
				console.log("--------------------------------")
			} else {
				throw new Error(`Unknown webhook type, ${webhook_type}`)
			}
			res.status(200).json(req.body)
		} else {
			throw new Error("API KEY IS INVALID!")
		}
	} catch (err) {
		console.error(err)
		res.status(400).json({
			error: {...err}
		})
	}
})

module.exports = router;