// This obviously doesn't need to be a separate file, but it's here to
// demonstrate that you can split up your summon code like this.
import isEqual from './isEqual.ts';
import isLarger from './isLarger.ts';

export default (io: Summon.IO) => {
  // Inputs from ID Holder (Bob)
  const age = io.input('bob', 'age', summon.number());
  const residency = io.input('bob', 'residency', summon.number());
  const nameHash = io.input('bob', 'nameHash', summon.number());

  // Inputs from Verifier (Alice)
  const minAge = io.input('alice', 'minAge', summon.number());
  const requiredResidency = io.input('alice', 'requiredResidency', summon.number());
  const requiredNameHash = io.input('alice', 'requiredNameHash', summon.number());

  let ageValid = 0;
  // Check if age is greater than minAge
  if (isLarger(age, minAge)) {
    ageValid = 1;
  }
  // Or check if age is equal to minAge
  if (isEqual(age, minAge)) {
    ageValid = 1;
  }

  let residencyValid = 0;
  if (isEqual(residency, requiredResidency)) {
    residencyValid = 1;
  }

  let nameValid = 0;
  if (isEqual(nameHash, requiredNameHash)) {
    nameValid = 1;
  }

  // Output independent results
  io.outputPublic('ageValid', ageValid);
  io.outputPublic('residencyValid', residencyValid);
  io.outputPublic('nameValid', nameValid);
};
