const mongoose = require("mongoose");

const packageSchema = new mongoose.Schema({
	description: {
		type: "string",
	},
	dropoffLocation: {
		fullAddress: "",
		street_address: "",
		city: "",
		postcode: "",
		firstname: "",
		lastname: "",
		email: "",
		phoneNumber: "",
		businessName: "",
		instructions: ""
	},
	pickupLocation: {
		fullAddress: "",
		street_address: "",
		city: "",
		postcode: "",
		firstname: "",
		lastname: "",
		email: "",
		phoneNumber: "",
		businessName: "",
		instructions: ""
	},
	pickupStartTime: {
		type: Date
	},
	dropoffStartTime: {
		type: Date
	},
	pickupEndTime: {
		type: Date
	},
	dropoffEndTime: {
		type: Date
	}
})

module.exports = packageSchema;