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
		case JOB_STATUS.COMPLETED:
			return STATUS.COMPLETED
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

exports.deliveryUpdate = async (req, res) => {
	try {
		//if event is a delivery update
		const {event, type, data } = req.body;
		let response = {
			message: "event unrecognised"
		}
		if (event && event === "job") {
			if (type && type === "create") {
				console.log("JOB CREATE")
				await updateJob(data)
				response = {...data}
			}
			if (type && type === "update") {
				console.log("JOB UPDATE")
				await updateJob(data)
				response = {...data}
			}
		}
		if (event && event === "delivery") {
			if (type && type === "create") {
				console.log("DELIVERY CREATE")
				await updateDelivery(data.currentDelivery)
				response = {...data }
			}
			if (type && type === "update") {
				console.log("DELIVERY UPDATE")
				await updateDelivery(data.currentDelivery)
				response = {...data }
				// const foundJob = await db.Job.findOne({"clientReferenceNumber": clientReferenceNumber}, {})
				// console.log(foundJob)
			}
		}
		return res.status(200).json({
			...response
		})
	} catch (err) {
		console.error(err)
		return res.status(500).json({
			...err
		})
	}
}
