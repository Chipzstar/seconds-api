const express = require("express");
const {JOB_STATUS } = require("../constants/gophr");
const {STATUS, AUTH_KEYS} = require("../constants");
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

async function update(data){
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
					"jobSpecification.packages.$[].pickupStartTime": moment(pickup_eta).toISOString(),
					"jobSpecification.packages.$[].dropoffStartTime": moment(delivery_eta).toISOString(),
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

router.post("/", async (req, res) => {
	try {
		// GOPHR
		if (req.body['api_key'] === AUTH_KEYS.GOPHR) {
			let jobStatus = await update(req.body)
			console.log("--------------------------------")
			console.log("NEW STATUS:", jobStatus)
			console.log("--------------------------------")
			res.status(200).json({
				...req.body
			})
		} else {
			throw new Error("API KEY IS INVLAID!")
		}
	} catch (err) {
		console.error(err)
		res.status(400).json({
			error: {...err}
		})
	}
})

module.exports = router;