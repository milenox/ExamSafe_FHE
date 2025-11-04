pragma solidity ^0.8.24;

import { FHE, euint32, externalEuint32 } from "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract ExamSafe_FHE is ZamaEthereumConfig {
    struct Exam {
        string examId;
        euint32 encryptedScore;
        uint32 publicScore;
        string studentId;
        address grader;
        uint256 timestamp;
        bool isGraded;
    }

    mapping(string => Exam) public exams;
    string[] public examIds;

    event ExamSubmitted(string indexed examId, address indexed student);
    event ExamGraded(string indexed examId, uint32 score);

    constructor() ZamaEthereumConfig() {}

    function submitExam(
        string calldata examId,
        externalEuint32 encryptedScore,
        bytes calldata inputProof,
        string calldata studentId
    ) external {
        require(bytes(exams[examId].examId).length == 0, "Exam already exists");
        require(FHE.isInitialized(FHE.fromExternal(encryptedScore, inputProof)), "Invalid encrypted input");

        exams[examId] = Exam({
            examId: examId,
            encryptedScore: FHE.fromExternal(encryptedScore, inputProof),
            publicScore: 0,
            studentId: studentId,
            grader: address(0),
            timestamp: block.timestamp,
            isGraded: false
        });

        FHE.allowThis(exams[examId].encryptedScore);
        FHE.makePubliclyDecryptable(exams[examId].encryptedScore);
        examIds.push(examId);

        emit ExamSubmitted(examId, msg.sender);
    }

    function gradeExam(
        string calldata examId,
        bytes memory abiEncodedScore,
        bytes memory decryptionProof
    ) external {
        require(bytes(exams[examId].examId).length > 0, "Exam does not exist");
        require(!exams[examId].isGraded, "Exam already graded");

        bytes32[] memory cts = new bytes32[](1);
        cts[0] = FHE.toBytes32(exams[examId].encryptedScore);

        FHE.checkSignatures(cts, abiEncodedScore, decryptionProof);
        uint32 decodedScore = abi.decode(abiEncodedScore, (uint32));

        exams[examId].publicScore = decodedScore;
        exams[examId].grader = msg.sender;
        exams[examId].isGraded = true;

        emit ExamGraded(examId, decodedScore);
    }

    function getEncryptedScore(string calldata examId) external view returns (euint32) {
        require(bytes(exams[examId].examId).length > 0, "Exam does not exist");
        return exams[examId].encryptedScore;
    }

    function getExamDetails(string calldata examId) external view returns (
        string memory studentId,
        uint32 publicScore,
        address grader,
        uint256 timestamp,
        bool isGraded
    ) {
        require(bytes(exams[examId].examId).length > 0, "Exam does not exist");
        Exam storage exam = exams[examId];

        return (
            exam.studentId,
            exam.publicScore,
            exam.grader,
            exam.timestamp,
            exam.isGraded
        );
    }

    function getAllExamIds() external view returns (string[] memory) {
        return examIds;
    }

    function serviceStatus() public pure returns (bool operational) {
        return true;
    }
}


