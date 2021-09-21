const {AUTHORIZATION_KEY} = require("../constants");
const db = require("../models");

exports.newJob = async (req, res) => {
	try {
		const { event } = req.body;
		if (event && event === "delivery") {
			console.log("DELIVERY UPDATE")
			console.log(req.body)
			// const foundJob = await db.Job.findOne({"clientReferenceNumber": clientReferenceNumber}, {})
			// console.log(foundJob)
			return res.status(200).json({
				...req.body
			})
		}
		return res.status(200).send("PASS")
	} catch (err) {
		console.error(err)
		return res.status(500).json({
			...err
		})
	}
}