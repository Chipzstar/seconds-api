exports.ERROR_MESSAGES = {
	ACCESS_TOKEN_REVOKED: 'The access token was revoked'
}

exports.ERROR_CODES = {
	UNPROCESSABLE_ENTITY: 422,
	INVALID_GRANT: 401,
	RECORD_INVALID: "RECORD_INVALID",
	JOB_DISTANCE_NOT_ALLOWED: "JOB_DISTANCE_NOT_ALLOWED",
	PHONE_INVALID: "PHONE_INVALID",
	OUT_OF_RANGE: "OUT_OF_RANGE",
	ADDRESS_CONTACT_PHONE_REQUIRED: "ADDRESS_CONTACT_PHONE_REQUIRED"
}

exports.JOB_STATUS = {
	NEW: "new",
	PENDING: "searching",
	IN_PROGRESS: "in_progress",
	COMPLETED: "finished",
	CANCELLED: "canceled"
}

exports.DELIVERY_STATUS = {
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