/**
 * Server face check after a worker's password (shared by WorkerLogin and WorkerQuickLogin).
 *
 * verify_worker_login returns a short-lived face challenge instead of a session for workers with
 * Face ID enabled; the session is issued only once complete_worker_login_after_face passes.
 * Errors are thrown as `{ userMessage }`, which FaceMatchPrompt shows on its failure screen.
 */
import { completeWorkerLoginAfterFace, enrollWorkerFace, parseLoginError } from '@/core/auth/timesheetSession';

const reject = (error, fallback) => {
    throw { userMessage: parseLoginError(error, fallback) };
};

/**
 * What the face step needs for this login, or null when the server already issued a session.
 * @returns {{ mode: 'verify'|'enroll', worker, type, password, challengeId } | null}
 * @throws {Error} when a challenge was expected but is missing
 */
export function faceChallengeFor(worker, type, password) {
    if (!worker.needs_face && worker.session_token) return null;
    if (!worker.face_challenge_id) throw new Error('Face verification challenge missing. Please try again.');
    return {
        mode: worker.face_id_set && worker.face_embedding ? 'verify' : 'enroll',
        worker,
        type,
        password,
        challengeId: worker.face_challenge_id,
    };
}

/** Live face matched on the phone → server re-checks it and returns the full session token. */
export async function verifyFaceChallenge(challengeId, liveEmbedding) {
    let token;
    try {
        token = await completeWorkerLoginAfterFace(challengeId, liveEmbedding);
    } catch (error) {
        reject(error, 'Face ID not recognized');
    }
    if (!token) reject(null, 'Face ID not recognized');
    return token;
}

/** First login without an enrolled face: save it, then return the full session token. */
export async function enrollFaceChallenge({ worker, type, password, challengeId }, embedding) {
    let token;
    try {
        const saved = await enrollWorkerFace({
            employeeId: worker.employee_id,
            password,
            workerType: type,
            faceEmbedding: embedding,
        });
        if (!saved) reject(null, 'This account is no longer active or the password changed. Log in again.');
        token = await completeWorkerLoginAfterFace(challengeId, null);
    } catch (error) {
        if (error?.userMessage) throw error;
        reject(error, 'Could not save your Face ID. Try again.');
    }
    if (!token) reject(null, 'Could not finish logging in. Try again.');
    return token;
}
