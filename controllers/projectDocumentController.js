const ProjectDocument = require('../models/ProjectDocument');

exports.createDocument = async (req, res) => {
    try {
        const { projectId, title, description, uploadDate } = req.body;
        const fileUrl = req.file ? req.file.path : null;

        if (!fileUrl) {
            return res.status(400).json({ message: 'File is required' });
        }

        const newDoc = new ProjectDocument({
            projectId,
            title,
            description,
            uploadDate: uploadDate || new Date(),
            fileUrl,
            uploadedBy: req.user._id,
            companyId: req.user.companyId
        });

        await newDoc.save();
        res.status(201).json(newDoc);
    } catch (error) {
        console.error('Error creating document:', error);
        res.status(500).json({ message: error.message });
    }
};

exports.getProjectDocuments = async (req, res) => {
    try {
        const { projectId } = req.params;
        const documents = await ProjectDocument.find({ projectId })
            .populate('uploadedBy', 'name email')
            .sort({ createdAt: -1 });
        res.json(documents);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

exports.deleteDocument = async (req, res) => {
    try {
        const { id } = req.params;
        await ProjectDocument.findByIdAndDelete(id);
        res.json({ message: 'Document deleted successfully' });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};
