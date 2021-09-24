const pickupSchema = {
	address: "",
	comment: "",
	contact: {
		firstname: "",
		lastname: "",
		phone: "",
		email: "",
		company: ""
	}
}

const dropoffSchema = {
	package_type: "", // can be xsmall, small, medium, large, xlarge
	package_description: "",
	client_reference: "",
	address: "",
	comment: "",
	contact: {
		firstname: "",
		lastname: "",
		phone: "",
		email: "",
		company: ""
	},
	end_customer_time_window_start: "",
	end_customer_time_window_end: ""
}

module.exports = { pickupSchema, dropoffSchema }

