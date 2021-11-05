const mongoose = require('mongoose');

const openSchema = new mongoose.Schema({
	h: {
		type: Number,
		default: 7
	},
	m: {
		type: Number,
		default: 0
	},
	canDeliver: {
		type: Boolean,
		default: true
	}
})

const closeSchema = new mongoose.Schema({
	h: {
		type: Number,
		default: 18
	},
	m: {
		type: Number,
		default: 0
	},
	canDeliver: {
		type: Boolean,
		default: true
	}
})

const hoursSchema = new mongoose.Schema({
	open: {
		type: openSchema
	},
	close: {
		type: closeSchema
	},
});


const deliveryHoursSchema = new mongoose.Schema({
	0: {
		type: hoursSchema,
	},
	1: {
		type: hoursSchema,
	},
	2: {
		type: hoursSchema,
	},
	3: {
		type: hoursSchema,
	},
	4: {
		type: hoursSchema,
	},
	5: {
		type: hoursSchema,
	},
	6: {
		type: hoursSchema,
	}
})

module.exports = { deliveryHoursSchema, openSchema, closeSchema };
