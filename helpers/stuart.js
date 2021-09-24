const { STATUS } = require("../constants");
const db = require("../models");
const {JOB_STATUS, DELIVERY_STATUS} = require("../constants/stuart");

function translateStuartStatus(value) {
	switch (value) {
		case JOB_STATUS.NEW:
			return STATUS.NEW
		case DELIVERY_STATUS.PENDING:
			return STATUS.PENDING
		case JOB_STATUS.PENDING:
			return STATUS.PENDING
		case JOB_STATUS.IN_PROGRESS:
			return STATUS.DISPATCHING
		case DELIVERY_STATUS.ALMOST_PICKING:
			return STATUS.DISPATCHING
		case DELIVERY_STATUS.PICKING:
			return STATUS.DISPATCHING
		case DELIVERY_STATUS.WAITING_AT_PICKUP:
			return STATUS.DISPATCHING
		case DELIVERY_STATUS.DELIVERING:
			return STATUS.EN_ROUTE
		case DELIVERY_STATUS.ALMOST_DELIVERING:
			return STATUS.EN_ROUTE
		case DELIVERY_STATUS.WAITING_AT_DROPOFF:
			return STATUS.EN_ROUTE
		case DELIVERY_STATUS.DELIVERED:
			return STATUS.COMPLETED
		case JOB_STATUS.COMPLETED:
			return STATUS.COMPLETED
		case DELIVERY_STATUS.CANCELLED:
			return STATUS.CANCELLED
		case JOB_STATUS.CANCELLED:
			return STATUS.CANCELLED
		default:
			return value
	}
}

async function updateJob(data) {
	try {
		console.log(data)
		const {status: STATUS, jobReference: REFERENCE} = data;
		console.log({STATUS, REFERENCE})
		// update the status for the current job
		const updatedJob = await db.Job.findOneAndUpdate(
			{"selectedConfiguration.jobReference": REFERENCE},
			{"status": translateStuartStatus(STATUS)},
			{new: true}
		)
		console.log(updatedJob)
		return updatedJob
	} catch (err) {
		console.error(err)
		throw err
	}
}

async function updateDelivery(data) {
	try {
		console.log(data)
		const {status: STATUS, clientReference: REFERENCE} = data;
		console.log({STATUS, REFERENCE})
		// update the status for the current job
		const updatedJob = await db.Job.findOneAndUpdate(
			{"selectedConfiguration.jobReference": REFERENCE},
			{"status": translateStuartStatus(STATUS)},
			{new: true}
		)
		console.log(updatedJob)
		return updatedJob
	} catch (err) {
		console.error(err)
		throw err
	}
}

module.exports = { updateDelivery, updateJob }