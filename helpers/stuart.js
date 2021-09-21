exports.newDelivery = async (req, res) => {
	try {
		console.log(req.body)
		return res.status(200).json({
			...req.body
		})
	} catch (err) {
	    console.error(err)
	}
}