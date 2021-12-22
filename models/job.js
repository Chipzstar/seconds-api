const mongoose = require("mongoose");
const deliverySchema = require("./deliveries");
const { pointSchema } = require('./pointSchema');

const jobSchema = new mongoose.Schema({
	clientId: {
		type: mongoose.Schema.Types.ObjectId,
		required: true
	},
	commissionCharge: {
		type: Boolean,
		default: false
	},
	paymentIntentId: {
		type: String,
	},
	jobSpecification: {
		id: {
			type: String,
			required: true,
		},
		jobReference: {
			type: String,
		},
		shopifyId: {
			type: String,
			default: null
		},
		orderNumber: {
			type: String,
			unique: true,
			required: true,
		},
		deliveryType: String,
		pickupStartTime: {
			type: Date,
			required: false
		},
		pickupEndTime: {
			type: Date,
			required: false
		},
		pickupLocation: {
			fullAddress: "",
			streetAddress: "",
			city: "",
			postcode: "",
			latitude: 0,
			longitude: 0,
			firstName: "",
			lastName: "",
			email: "",
			phoneNumber: "",
			businessName: "",
			instructions: ""
		},
		deliveries: [deliverySchema]
	},
	selectedConfiguration: {
		createdAt: Date,
		deliveryFee: mongoose.Schema.Types.Number,
		winnerQuote: "",
		providerId: "",
		quotes: []
	},
	driverInformation: {
		name: {
			type: String,
			default: "Searching"
		},
		phone: {
			type: String,
			default: "Searching"
		},
		transport: {
			type: String,
			default: "Searching"
		},
		location: {
			type: pointSchema,
			index: '2dsphere'
		}
	},
	createdAt: {
		type: Date,
		required: true
	},
	status: {
		type: String,
		required: true,
	}
});

const Job = mongoose.model("Job", jobSchema);

module.exports = Job;