require('dotenv').config();
const ObjectId = require('mongoose').Types.ObjectId;

const validateJobId = async (req, res, next) => {
	try {
		if (ObjectId.isValid(id)) {
			if (String(new ObjectId(id)) === id) return next();
			return res.status(400).json({
				code: 400,
				message: "INVALID JOB_ID",
				description: "The Job ID you passed in is not a valid"
			});
		}
		return res.status(400).json({
			code: 400,
			message: "BAD_FORMAT",
			description: "The Job ID passed in must be a string of 12 bytes or a string of 24 hex characters."
		});
	} catch (err) {
		console.error(err);
		return res.status(500).json({
			...err
		});
	}
};

module.exports = { validateJobId }