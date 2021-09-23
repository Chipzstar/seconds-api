const express = require("express");
const { updateJob, updateDelivery  } = require("../helpers/stuart");
const router = express.Router();

router.post("/delivery-update", async (req, res) => {
	try {
		//if event is a delivery update
		const {event, type, data } = req.body;
		let response = {
			message: "event unrecognised"
		}
		if (event && event === "job") {
			if (type && type === "create") {
				console.log("JOB CREATE")
				await updateJob(data)
				response = {...data}
			}
			if (type && type === "update") {
				console.log("JOB UPDATE")
				await updateJob(data)
				response = {...data}
			}
		}
		if (event && event === "delivery") {
			if (type && type === "create") {
				console.log("DELIVERY CREATE")
				console.log(data)
				await updateDelivery(data)
				response = {...data }
			}
			if (type && type === "update") {
				console.log("DELIVERY UPDATE")
				console.log(data)
				await updateDelivery(data)
				response = {...data }
				// const foundJob = await db.Job.findOne({"clientReferenceNumber": clientReferenceNumber}, {})
				// console.log(foundJob)
			}
		}
		return res.status(200).json({
			...response
		})
	} catch (err) {
		console.error(err)
		return res.status(500).json({
			...err
		})
	}
})

module.exports = router;

