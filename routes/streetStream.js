require("dotenv").config();
const express = require("express");
const {STATUS} = require("../constants");
const {JOB_STATUS} = require("../constants/streetStream");
const db = require("../models");
const moment = require("moment");
const router = express.Router();

function translateStreetStreamStatus(value) {
	switch (value) {
		case JOB_STATUS.ARRIVED_AT_COLLECTION:
			return STATUS.DISPATCHING
		case JOB_STATUS.COLLECTED:
			return STATUS.EN_ROUTE
		case JOB_STATUS.DELIVERED:
			return STATUS.EN_ROUTE
		case JOB_STATUS.COMPLETED_SUCCESSFULLY:
			return STATUS.COMPLETED
		default:
			return STATUS.PENDING
	}
}

async function update(data){
	try {
		console.log(data)
		const {status: STATUS, jobId: ID } = data
		console.log({STATUS, ID})
		// update the status for the current job
		let job = await db.Job.findOneAndUpdate(
			{"jobSpecification.id": ID},
			{"status": translateStreetStreamStatus(STATUS)},
			{new: true}
		)
		if (job){
			console.log(job)
			return job.status
		}
		throw {status: "NO_JOB_FOUND", message: `The jobId ${ID} does not exist`}
	} catch (err) {
		console.error(err)
		throw err
	}
}

router.post("/", async (req, res) => {
	try {
		let jobStatus = await update(req.body)
	    res.status(200).send({
		    success: true,
		    status: "NEW_JOB_STATUS",
		    message: `$Job status is now ${jobStatus}`
	    })
	} catch (err) {
	    console.error(err)
		res.status(200).json({
			success: false,
			status: err.status,
			message: err.message
		})
	}
})

module.exports = router;