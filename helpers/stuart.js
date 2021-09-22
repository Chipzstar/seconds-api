const { STATUS } = require("../constants");
const db = require("../models");
const {JOB_STATUS} = require("../constants/stuart");

function translateStuartStatus(value) {
	switch (value) {
		case JOB_STATUS.NEW:
			return STATUS.NEW
		case JOB_STATUS.PENDING:
			return STATUS.PENDING
		case JOB_STATUS.DISPATCHING:
			return STATUS.DISPATCHING
		case JOB_STATUS.EN_ROUTE:
			return STATUS.EN_ROUTE
		case JOB_STATUS.COMPLETED:
			return STATUS.COMPLETED
		case JOB_STATUS.CANCELLED:
			return STATUS.CANCELLED
		default:
			return value
	}
}

async function update(data) {
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
				await update(data)
				response = {...data}
			}
			if (type && type === "update") {
				console.log("JOB UPDATE")
				await update(data)
				response = {...data}
			}
		}
		if (event && event === "delivery") {
			if (type && type === "create") {
				console.log("DELIVERY CREATE")
				response = {...data }
			}
			if (type && type === "update") {
				console.log("DELIVERY UPDATE")
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
