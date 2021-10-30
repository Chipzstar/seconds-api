const db = require("../models");
const moment = require("moment");
const { STATUS } = require("../constants");
const {JOB_STATUS, DELIVERY_STATUS} = require("../constants/stuart");

/**
 * Maps the current job status of a STUART delivery with the SECONDS delivery status
 * @param value - delivery status returned from the stuart delivery update
 * @returns {string|*}
 */
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

async function update(data, type) {
	try {
		console.log(data)
		const STATUS = data.status;
		const REFERENCE = type === "job" ? data.jobReference : data.clientReference;
		const {etaToOrigin, etaToDestination} = type === "job" ? data.currentDelivery : data;
		console.log({STATUS, REFERENCE})
		// update the status for the current job
		await db.Job.findOneAndUpdate(
			{"selectedConfiguration.jobReference": REFERENCE},
			{"status": translateStuartStatus(STATUS)},
			{new: true}
		)
		if (type === "delivery"){
			const { firstname, lastname, phone, transportType: {code} } = data.driver;
			await db.Job.findOneAndUpdate(
				{"selectedConfiguration.jobReference": REFERENCE},
				{
					"driverInformation.name": `${firstname} ${lastname}`,
					"driverInformation.phone": phone,
					"driverInformation.transport": code
				}
			)
		}
		let {_doc: { _id, ...job} } = await db.Job.findOneAndUpdate(
			{"selectedConfiguration.jobReference": REFERENCE},
			{
				'$set': {
					"jobSpecification.packages.$[].pickupStartTime": moment(etaToOrigin).toISOString(),
					"jobSpecification.packages.$[].dropoffStartTime": moment(etaToDestination).toISOString()
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

module.exports = { update }