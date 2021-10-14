exports.ERROR_CODES = {
	UNPROCESSABLE_ENTITY: 422,
	INVALID_GRANT: 401,
	RECORD_INVALID: "RECORD_INVALID"
}

exports.JOB_STATUS = {
	NEW: "new",
	PENDING: "searching",
	IN_PROGRESS: "in_progress",
	COMPLETED: "finished",
	CANCELLED: "canceled"
}

exports.DELIVERY_STATUS = {
	NEW: "N/A",
	PENDING: "pending",
	ALMOST_PICKING: "almost_picking",
	PICKING: "picking",
	WAITING_AT_PICKUP: "waiting_at_pickup",
	DELIVERING: "delivering",
	ALMOST_DELIVERING: "almost_delivering",
	WAITING_AT_DROPOFF: "waiting_at_dropoff",
	DELIVERED: "delivered",
	CANCELLED: "cancelled"
}