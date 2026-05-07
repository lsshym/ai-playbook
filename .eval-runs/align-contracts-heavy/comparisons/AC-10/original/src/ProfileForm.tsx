type FormState = {
  firstName: string;
  lastName: string;
};

type CreateProfileRequest = {
  full_name: string;
};

export function handleSubmit(form: FormState, submit: (request: CreateProfileRequest) => void) {
  submit({
    firstName: form.firstName,
    lastName: form.lastName,
  });
}
