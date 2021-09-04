const {nanoid} = require('nanoid')
const moment = require("moment");

const package_types = ["xlarge", "large", "medium", "small", "xsmall"]

exports.dummyQuote = {
	id: nanoid(9),
	created_at: moment().toISOString(),
	status: "searching",
	package_type: "xlarge",
	transport_type: null,
	assignment_code: "",
	pickup_at: null,
	dropoff_at: null,
	ended_at: null,
	comment: null,
	distance: 0, //in km
	duration: Math.floor(Math.random() * 30), //in minutes
	traveled_time: 0,
	traveled_distance: 0,
	deliveries: [],
	driver: null,
	pricing: {
		price_tax_included: 0.00,
		price_tax_excluded: 0.00,
		tax_amount: 0.00,
		invoice_url: null,
		tax_percentage: 0.2,
		currency: "GBP"
	},
	rating: null
}

const dummy = {
	id: nanoid(7),
	address: {
		street: "",
		postcode: "",
		city: "",
		zone: "",
		country: "",
		formatted_address: ""
	},
	comment: "",
	contact: {
		firstname: "",
		lastname: "",
		phone: "",
		company_name: "",
		email: ""
	},
	access_codes: []
}

exports.dummyDelivery = {
	id: nanoid(9),
	status: "pending",
	picked_at: null,
	delivered_at: null,
	tracking_url: "https://stuart.sandbox.followmy.delivery/100212758/963ded3493a4d6209457cb7e992f6c29",
	client_reference: "",
	package_description: "Gaming console",
	package_type: "small",
	fleet_ids: [
		1
	],
	pickup: {},
	dropoff: {},
	cancellation: {
		canceled_by: null,
		reason_key: null,
		comment: null
	},
	eta: {
		pickup: null,
		dropoff: null
	},
	proof: {
		signature_url: null
	},
	package_image_url: null
}